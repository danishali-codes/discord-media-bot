import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { AppContext } from './context';
import type { LinkRecord, PendingLink } from './db';
import { matchSeerrUser, type LinkService } from './match';
import { posterUrl, SeerrRequestError, type MediaKind, type SearchHit } from './seerr';

const BLURPLE = 0x5865f2;
const GREEN = 0x3ba55d;
const YELLOW = 0xfee75c;

export function registerHandlers(client: AppContext['client'], ctx: AppContext): void {
  client.on('guildMemberAdd', (member) => {
    if (member.user.bot || member.guild.id !== ctx.env.DISCORD_GUILD_ID) return;
    member
      .send(
        [
          'Welcome. To request movies and shows, link the Jellyfin or Plex account you use with Seerr.',
          '',
          'In the server, run `/link-account` with your username and choose jellyfin or plex. An admin confirms it.',
          'A Seerr display name works too when it differs from the login.',
          'If nothing matches, check the spelling or ask an admin.',
        ].join('\n'),
      )
      .catch(() => {
        console.warn('Welcome DM failed', member.id);
      });
  });

  client.on('interactionCreate', (interaction) => {
    handleInteraction(interaction, ctx).catch((error) => {
      console.error('interaction failed', error);
      if (!interaction.isRepliable()) return;
      const content = 'Something went wrong. Try again.';
      const send =
        interaction.deferred || interaction.replied
          ? interaction.followUp({ content, flags: MessageFlags.Ephemeral })
          : interaction.reply({ content, flags: MessageFlags.Ephemeral });
      send.catch(() => undefined);
    });
  });
}

async function handleInteraction(interaction: Interaction, ctx: AppContext): Promise<void> {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'link-account') return linkAccount(interaction, ctx);
    if (interaction.commandName === 'unlink-account') return unlinkAccount(interaction, ctx);
    if (interaction.commandName === 'request') return requestTitle(interaction, ctx);
    return;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === 'request:pick') {
    return pickResult(interaction, ctx);
  }
  if (interaction.isButton() && interaction.customId.startsWith('request:season:')) {
    return pickSeason(interaction, ctx);
  }
  if (interaction.isButton() && interaction.customId.startsWith('seerr:')) {
    return moderate(interaction, ctx);
  }
  if (interaction.isButton() && interaction.customId.startsWith('link:')) {
    return decideLink(interaction, ctx);
  }
}

async function linkAccount(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  const username = interaction.options.getString('username', true).trim();
  const serviceName = interaction.options.getString('service', true);
  if (serviceName !== 'jellyfin' && serviceName !== 'plex') {
    await interaction.reply({ content: 'Pick Jellyfin or Plex.', flags: MessageFlags.Ephemeral });
    return;
  }
  const service: LinkService = serviceName;
  if (!username) {
    await interaction.reply({
      content: 'Enter the username you use in Jellyfin or Plex.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const users = await ctx.seerr.listUsers();
    const match = matchSeerrUser(users, username, service);
    if (match.status === 'none') {
      await interaction.editReply(
        `No ${serviceLabel(service)} user named "${username}" in Seerr. Check the spelling, or ask an admin to confirm the account exists.`,
      );
      return;
    }
    if (match.status === 'ambiguous') {
      await interaction.editReply(
        `More than one Seerr user matches "${username}". Ask an admin which account to use.`,
      );
      return;
    }
    const pending = {
      discordId: interaction.user.id,
      seerrUserId: match.user.id,
      username,
      service,
      displayName: match.user.displayName ?? null,
      jellyfinUsername: match.user.jellyfinUsername ?? null,
      plexUsername: match.user.plexUsername ?? null,
    };
    const requested = ctx.db.requestLink(pending);
    if (requested === 'discord-pending') {
      await interaction.editReply('You already have a link request waiting for an admin.');
      return;
    }
    if (requested === 'seerr-linked') {
      await interaction.editReply('That Seerr account is already linked.');
      return;
    }
    if (requested === 'seerr-pending') {
      await interaction.editReply('That Seerr account is already waiting on another link request.');
      return;
    }
    const posted = await postLinkRequest(interaction, ctx, pending);
    if (!posted) {
      ctx.db.denyPending(interaction.user.id);
      await interaction.editReply('Could not reach the admin channel. Try again later.');
      return;
    }
    await interaction.editReply('Link request sent to the admins for approval.');
  } catch (error) {
    await interaction.editReply(failureText(error, 'Could not look up Seerr users.'));
  }
}

async function unlinkAccount(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  const removed = ctx.db.unlink(interaction.user.id);
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: removed ? 'Unlinked. Use /link-account when you want to request again.' : 'No linked account to remove.',
  });
}

async function requestTitle(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (interaction.channelId !== ctx.env.REQUESTS_CHANNEL_ID) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `Use /request in <#${ctx.env.REQUESTS_CHANNEL_ID}>.`,
    });
    return;
  }
  const gate = accountGate(ctx, interaction.user.id);
  if (!gate.ok) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: gate.message });
    return;
  }
  const title = interaction.options.getString('title', true).trim();
  if (!title) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Enter a title to search for.' });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const hits = dedupeHits((await ctx.seerr.search(title)).slice(0, 5));
    if (hits.length === 0) {
      await interaction.editReply(
        `Nothing matched "${clip(title, 80)}". Try a shorter title, drop the subtitle, or add the year (for example \`Dune 2021\`).`,
      );
      return;
    }
    const menu = new StringSelectMenuBuilder()
      .setCustomId('request:pick')
      .setPlaceholder('Pick a match')
      .addOptions(
        hits.map((hit) => ({
          label: optionLabel(hit),
          description: hit.mediaType === 'movie' ? 'Movie' : 'TV',
          value: `${hit.mediaType}:${hit.mediaId}`,
        })),
      );
    await interaction.editReply({
      content: "Seerr's search allows close spellings. Pick a movie or show:",
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    });
  } catch (error) {
    await interaction.editReply(failureText(error, 'Seerr search failed.'));
  }
}

async function pickResult(interaction: StringSelectMenuInteraction, ctx: AppContext): Promise<void> {
  const parsed = /^(movie|tv):(\d+)$/.exec(interaction.values[0] ?? '');
  if (!parsed) {
    await interaction.update({ content: 'That choice is out of date. Run /request again.', components: [] });
    return;
  }
  const mediaType = parsed[1] as MediaKind;
  const mediaId = Number(parsed[2]);
  const gate = accountGate(ctx, interaction.user.id);
  if (!gate.ok) {
    await interaction.update({ content: gate.message, embeds: [], components: [] });
    return;
  }
  const link = gate.link;

  await interaction.deferUpdate();
  try {
    if (mediaType === 'movie') {
      const movie = await ctx.seerr.getMovie(mediaId);
      if (movie.availability === 'available') {
        await interaction.editReply({
          content: null,
          embeds: [
            resultEmbed({
              title: movie.title,
              year: movie.year,
              posterPath: movie.posterPath,
              detail: 'This is already available.',
              color: YELLOW,
            }),
          ],
          components: [],
        });
        return;
      }
      const created = await ctx.seerr.createRequest({
        mediaType: 'movie',
        mediaId,
        userId: link.seerrUserId,
      });
      await interaction.editReply({
        content: null,
        embeds: [
          resultEmbed({
            title: movie.title,
            year: movie.year,
            posterPath: movie.posterPath,
            detail: created.outcome === 'created' ? 'Requested.' : created.message,
            color: created.outcome === 'created' ? GREEN : YELLOW,
          }),
        ],
        components: [],
      });
      return;
    }

    const show = await ctx.seerr.getTv(mediaId);
    if (show.seasonNumbers.length === 0) {
      await interaction.editReply({
        content: null,
        embeds: [
          resultEmbed({
            title: show.title,
            year: show.year,
            posterPath: show.posterPath,
            detail: 'This show has no regular seasons to request.',
            color: YELLOW,
          }),
        ],
        components: [],
      });
      return;
    }
    const latest = show.seasonNumbers[show.seasonNumbers.length - 1];
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`request:season:all:${mediaId}`)
        .setLabel('All seasons')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`request:season:latest:${mediaId}:${latest}`)
        .setLabel(`Latest season (${latest})`)
        .setStyle(ButtonStyle.Secondary),
    );
    await interaction.editReply({
      content: null,
      embeds: [
        resultEmbed({
          title: show.title,
          year: show.year,
          posterPath: show.posterPath,
          detail: 'Request every season, or only the latest?',
          color: BLURPLE,
        }),
      ],
      components: [row],
    });
  } catch (error) {
    await interaction.editReply({
      content: failureText(error, 'Could not load that title from Seerr.'),
      embeds: [],
      components: [],
    });
  }
}

async function pickSeason(interaction: ButtonInteraction, ctx: AppContext): Promise<void> {
  const parsed = /^request:season:(all|latest):(\d+)(?::(\d+))?$/.exec(interaction.customId);
  if (!parsed) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: 'That button is out of date. Run /request again.',
    });
    return;
  }
  const mode = parsed[1] as 'all' | 'latest';
  const mediaId = Number(parsed[2]);
  const chosenSeason = parsed[3] ? Number(parsed[3]) : undefined;
  const gate = accountGate(ctx, interaction.user.id);
  if (!gate.ok) {
    await interaction.update({ content: gate.message, embeds: [], components: [] });
    return;
  }
  const link = gate.link;

  await interaction.deferUpdate();
  try {
    const show = await ctx.seerr.getTv(mediaId);
    const latest = chosenSeason ?? show.seasonNumbers[show.seasonNumbers.length - 1];
    if (mode === 'latest' && !latest) {
      await interaction.editReply({
        content: null,
        embeds: [
          resultEmbed({
            title: show.title,
            year: show.year,
            posterPath: show.posterPath,
            detail: 'This show has no regular seasons to request.',
            color: YELLOW,
          }),
        ],
        components: [],
      });
      return;
    }
    const seasons = mode === 'latest' && latest ? [latest] : 'all';
    const created = await ctx.seerr.createRequest({
      mediaType: 'tv',
      mediaId,
      userId: link.seerrUserId,
      seasons,
    });
    const requested = mode === 'latest' && latest ? `Requested season ${latest}.` : 'Requested all seasons.';
    await interaction.editReply({
      content: null,
      embeds: [
        resultEmbed({
          title: show.title,
          year: show.year,
          posterPath: show.posterPath,
          detail: created.outcome === 'created' ? requested : created.message,
          color: created.outcome === 'created' ? GREEN : YELLOW,
        }),
      ],
      components: [],
    });
  } catch (error) {
    await interaction.editReply({
      content: failureText(error, 'Could not send that request to Seerr.'),
      embeds: [],
      components: [],
    });
  }
}

async function moderate(interaction: ButtonInteraction, ctx: AppContext): Promise<void> {
  const parsed = /^seerr:(approve|decline):(\d+)$/.exec(interaction.customId);
  if (!parsed) return;
  const action = parsed[1] as 'approve' | 'decline';
  const requestId = Number(parsed[2]);
  if (!canManage(interaction, ctx.env.ADMIN_ROLE_ID)) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: 'You do not have permission to approve or decline requests.',
    });
    return;
  }

  await interaction.deferUpdate();
  try {
    if (action === 'approve') await ctx.seerr.approve(requestId);
    else await ctx.seerr.decline(requestId);
    const embed = keptEmbed(interaction)
      .setColor(action === 'approve' ? GREEN : 0xed4245)
      .setFooter({ text: `${action === 'approve' ? 'Approved' : 'Declined'} by ${interaction.user.tag}` });
    await interaction.editReply({ embeds: [embed], components: [] });
  } catch (error) {
    const text = failureText(error, 'Seerr could not update that request.');
    if (error instanceof SeerrRequestError && error.status === 409) {
      const embed = keptEmbed(interaction).setFooter({ text });
      await interaction.editReply({ embeds: [embed], components: [] });
      return;
    }
    await interaction.followUp({ flags: MessageFlags.Ephemeral, content: text });
  }
}

async function decideLink(interaction: ButtonInteraction, ctx: AppContext): Promise<void> {
  const parsed = /^link:(approve|deny):(\d+)$/.exec(interaction.customId);
  if (!parsed) return;
  const action = parsed[1] as 'approve' | 'deny';
  const discordId = parsed[2];
  if (!canManage(interaction, ctx.env.ADMIN_ROLE_ID)) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: 'You do not have permission to approve or deny link requests.',
    });
    return;
  }

  await interaction.deferUpdate();
  if (action === 'approve') {
    const result = ctx.db.approvePending(discordId);
    if (result.status === 'missing') {
      await interaction.followUp({ flags: MessageFlags.Ephemeral, content: 'That link request was already handled.' });
      return;
    }
    if (result.status === 'seerr-taken') {
      ctx.db.denyPending(discordId);
      await dm(ctx, discordId, 'Your link request was declined. Contact an admin if that seems wrong.');
      const embed = keptEmbed(interaction)
        .setColor(0xed4245)
        .setFooter({ text: `Denied by ${interaction.user.tag}` });
      await interaction.editReply({ embeds: [embed], components: [linkButtons(discordId, true)] });
      return;
    }
    await dm(ctx, discordId, "You're linked. You can request movies and shows with /request.");
    const embed = keptEmbed(interaction)
      .setColor(GREEN)
      .setFooter({ text: `Approved by ${interaction.user.tag}` });
    await interaction.editReply({ embeds: [embed], components: [linkButtons(discordId, true)] });
    return;
  }

  const denied = ctx.db.denyPending(discordId);
  if (!denied) {
    await interaction.followUp({ flags: MessageFlags.Ephemeral, content: 'That link request was already handled.' });
    return;
  }
  await dm(ctx, discordId, 'Your link request was declined. Contact an admin if that seems wrong.');
  const embed = keptEmbed(interaction)
    .setColor(0xed4245)
    .setFooter({ text: `Denied by ${interaction.user.tag}` });
  await interaction.editReply({ embeds: [embed], components: [linkButtons(discordId, true)] });
}

async function postLinkRequest(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
  pending: PendingLink,
): Promise<boolean> {
  const channel = await ctx.client.channels.fetch(ctx.env.ADMIN_CHANNEL_ID);
  if (!channel?.isSendable()) return false;
  const embed = new EmbedBuilder()
    .setTitle('Link account')
    .setColor(YELLOW)
    .addFields(
      { name: 'Discord', value: `${interaction.user} (${interaction.user.tag})` },
      { name: 'Name they typed', value: `${pending.username} (${pending.service})` },
      {
        name: 'Seerr user',
        value: [
          `Display name: ${pending.displayName ?? '—'}`,
          `Jellyfin: ${pending.jellyfinUsername ?? '—'}`,
          `Plex: ${pending.plexUsername ?? '—'}`,
          `Id: ${pending.seerrUserId}`,
        ].join('\n'),
      },
    );
  try {
    await channel.send({
      embeds: [embed],
      components: [linkButtons(pending.discordId, false)],
      allowedMentions: { users: [pending.discordId] },
    });
    return true;
  } catch (error) {
    console.error('link request post failed', error);
    return false;
  }
}

function linkButtons(discordId: string, disabled: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`link:approve:${discordId}`)
      .setLabel('Approve')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`link:deny:${discordId}`)
      .setLabel('Deny')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

function accountGate(ctx: AppContext, discordId: string): { ok: true; link: LinkRecord } | { ok: false; message: string } {
  const link = ctx.db.getByDiscord(discordId);
  if (link) return { ok: true, link };
  if (ctx.db.getPendingByDiscord(discordId)) {
    return { ok: false, message: 'Your link is awaiting approval.' };
  }
  return { ok: false, message: 'Link your Jellyfin or Plex account first with /link-account.' };
}

async function dm(ctx: AppContext, discordId: string, content: string): Promise<void> {
  try {
    const user = await ctx.client.users.fetch(discordId);
    await user.send(content);
  } catch {
    console.warn('DM failed', discordId);
  }
}

function canManage(interaction: ButtonInteraction, adminRoleId: string | undefined): boolean {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (!adminRoleId || !interaction.member) return false;
  const roles = interaction.member.roles;
  if (Array.isArray(roles)) return roles.includes(adminRoleId);
  return roles.cache.has(adminRoleId);
}

function keptEmbed(interaction: ButtonInteraction): EmbedBuilder {
  const current = interaction.message.embeds[0];
  return current ? EmbedBuilder.from(current) : new EmbedBuilder().setTitle('Request');
}

function resultEmbed(input: {
  title: string;
  year?: number;
  posterPath?: string;
  detail: string;
  color: number;
}): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(input.title).setDescription(input.detail).setColor(input.color);
  if (input.year) embed.addFields({ name: 'Year', value: String(input.year), inline: true });
  const poster = posterUrl(input.posterPath);
  if (poster) embed.setThumbnail(poster);
  return embed;
}

function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = `${hit.mediaType}:${hit.mediaId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function optionLabel(hit: SearchHit): string {
  const label = `${hit.title}${hit.year ? ` (${hit.year})` : ''}`;
  return clip(label || 'Untitled', 100);
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function serviceLabel(service: LinkService): string {
  return service === 'jellyfin' ? 'Jellyfin' : 'Plex';
}

function failureText(error: unknown, fallback: string): string {
  if (error instanceof SeerrRequestError && error.message) return error.message;
  return fallback;
}
