import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { canManage, dm, failureText } from './access';
import { isAllowed, parseAllowlist } from './allow';
import { ArcaneClient, arcaneConfigured } from './arcane';
import { BeszelClient, beszelConfigured, diskLine } from './beszel';
import type { AppContext } from './context';
import { clip } from './http';
import { JellyfinClient, jellyfinConfigured } from './jellyfin';
import { requestButtons } from './present';
import { posterUrl, type SearchHit } from './seerr';
import { TautulliClient, tautulliConfigured } from './tautulli';

const BLURPLE = 0x5865f2;
const GREEN = 0x3ba55d;
const RED = 0xed4245;
const YELLOW = 0xfee75c;

export async function handleAdminCommand(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<boolean> {
  switch (interaction.commandName) {
    case 'announce':
      await announce(interaction, ctx);
      return true;
    case 'nowplaying':
      await nowPlaying(interaction, ctx);
      return true;
    case 'pending':
      await pending(interaction, ctx);
      return true;
    case 'disk':
      await disk(interaction, ctx);
      return true;
    case 'restart':
      await restart(interaction, ctx);
      return true;
    case 'unlink':
      await unlinkMember(interaction, ctx);
      return true;
    default:
      return false;
  }
}

export async function handleAdminComponent(interaction: Interaction, ctx: AppContext): Promise<boolean> {
  if (interaction.isButton() && interaction.customId.startsWith('seerr:alter:')) {
    await alter(interaction, ctx);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith('seerr:retitle:')) {
    await showRetitle(interaction, ctx);
    return true;
  }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('seerr:seasons:')) {
    await approveSeasons(interaction, ctx);
    return true;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith('seerr:retitle-modal:')) {
    await retitleSearch(interaction, ctx);
    return true;
  }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('seerr:replace:')) {
    await replaceRequest(interaction, ctx);
    return true;
  }
  if (interaction.isModalSubmit() && interaction.customId === 'announce:modal') {
    await postAnnouncement(interaction, ctx);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith('restart:yes:')) {
    await confirmRestart(interaction, ctx);
    return true;
  }
  return false;
}

export async function autocompleteRestart(interaction: AutocompleteInteraction, ctx: AppContext): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = parseAllowlist(ctx.env.RESTART_ALLOWLIST)
    .filter((name) => name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((name) => ({ name, value: name }));
  await interaction.respond(choices);
}

async function announce(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!canManage(interaction, ctx.env.ADMIN_ROLE_ID)) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'You do not have permission to announce.' });
    return;
  }
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId('announce:modal')
      .setTitle('Announcement')
      .addLabelComponents(
        new LabelBuilder().setLabel('Title').setTextInputComponent(
          new TextInputBuilder().setCustomId('title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200),
        ),
        new LabelBuilder().setLabel('Message').setTextInputComponent(
          new TextInputBuilder().setCustomId('message').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000),
        ),
      ),
  );
}

async function postAnnouncement(interaction: ModalSubmitInteraction, ctx: AppContext): Promise<void> {
  if (!canManage(interaction, ctx.env.ADMIN_ROLE_ID)) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'You do not have permission to announce.' });
    return;
  }
  const title = interaction.fields.getTextInputValue('title').trim();
  const message = interaction.fields.getTextInputValue('message').trim();
  const embed = new EmbedBuilder().setColor(BLURPLE).setTitle(title).setDescription(message).setFooter({ text: `Announced by ${interaction.user.tag}` });
  const target = ctx.env.ANNOUNCE_CHANNEL_ID
    ? await ctx.client.channels.fetch(ctx.env.ANNOUNCE_CHANNEL_ID)
    : interaction.channel;
  if (!target?.isSendable()) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'No announce channel is available.' });
    return;
  }
  await target.send({ embeds: [embed] });
  await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Announcement posted.' });
}

async function nowPlaying(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!(await requireAdmin(interaction, ctx))) return;
  const tautulliOn = tautulliConfigured(ctx.env);
  const jellyfinOn = jellyfinConfigured(ctx.env);
  if (!tautulliOn && !jellyfinOn) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Neither Tautulli nor Jellyfin is configured.' });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const lines: string[] = [];
  if (tautulliOn && ctx.env.TAUTULLI_URL && ctx.env.TAUTULLI_API_KEY) {
    try {
      const sessions = await new TautulliClient(ctx.env.TAUTULLI_URL, ctx.env.TAUTULLI_API_KEY).activity();
      lines.push(sessions.length ? `**Plex**\n${sessions.map(streamLine).join('\n')}` : '**Plex**\nNobody is watching.');
    } catch (error) {
      lines.push(`**Plex**\n${failureText(error, 'Could not reach Tautulli.')}`);
    }
  }
  if (jellyfinOn && ctx.env.JELLYFIN_URL && ctx.env.JELLYFIN_API_KEY) {
    try {
      const sessions = await new JellyfinClient(ctx.env.JELLYFIN_URL, ctx.env.JELLYFIN_API_KEY).sessions();
      lines.push(sessions.length ? `**Jellyfin**\n${sessions.map(streamLine).join('\n')}` : '**Jellyfin**\nNobody is watching.');
    } catch (error) {
      lines.push(`**Jellyfin**\n${failureText(error, 'Could not reach Jellyfin.')}`);
    }
  }
  await interaction.editReply({
    embeds: [new EmbedBuilder().setColor(BLURPLE).setTitle('Now playing').setDescription(lines.join('\n\n').slice(0, 4000))],
  });
}

async function pending(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!(await requireAdmin(interaction, ctx))) return;
  await interaction.deferReply();
  try {
    const requests = (await ctx.seerr.listPending(5)).slice(0, 5);
    if (requests.length === 0) {
      await interaction.editReply('No requests are waiting for approval.');
      return;
    }
    let first = true;
    for (const request of requests) {
      const details = await loadTitle(ctx, request.mediaType, request.tmdbId);
      const embed = new EmbedBuilder()
        .setColor(YELLOW)
        .setTitle(details?.title ?? request.title ?? `Request ${request.id}`)
        .addFields(
          { name: 'Year', value: details?.year ? String(details.year) : 'Unknown', inline: true },
          { name: 'Type', value: request.mediaType === 'tv' ? 'TV' : 'Movie', inline: true },
        );
      const poster = posterUrl(details?.posterPath, 'w342');
      if (poster) embed.setThumbnail(poster);
      const payload = { embeds: [embed], components: [requestButtons(request.id)] };
      if (first) {
        await interaction.editReply(payload);
        first = false;
      } else if (interaction.channel?.isSendable()) {
        await interaction.channel.send(payload);
      }
    }
  } catch (error) {
    await interaction.editReply(failureText(error, 'Could not load pending requests.'));
  }
}

async function disk(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!(await requireAdmin(interaction, ctx))) return;
  if (!beszelConfigured(ctx.env) || !ctx.env.BESZEL_URL || !ctx.env.BESZEL_EMAIL || !ctx.env.BESZEL_PASSWORD) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Beszel is not configured.' });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const readings = await new BeszelClient(ctx.env.BESZEL_URL, ctx.env.BESZEL_EMAIL, ctx.env.BESZEL_PASSWORD).disks();
    if (readings.length === 0) {
      await interaction.editReply('Beszel returned no systems.');
      return;
    }
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(BLURPLE).setTitle('Disk').setDescription(readings.map(diskLine).join('\n').slice(0, 4000))],
    });
  } catch (error) {
    await interaction.editReply(failureText(error, 'Could not read Beszel.'));
  }
}

async function restart(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!(await requireAdmin(interaction, ctx))) return;
  if (interaction.channelId !== ctx.env.ADMIN_CHANNEL_ID) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Use /restart in <#${ctx.env.ADMIN_CHANNEL_ID}>.` });
    return;
  }
  if (!arcaneConfigured(ctx.env)) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Arcane is not configured.' });
    return;
  }
  const name = interaction.options.getString('service', true).trim();
  const allow = parseAllowlist(ctx.env.RESTART_ALLOWLIST);
  if (!isAllowed(allow, name)) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'That container is not on the restart allowlist.' });
    return;
  }
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`restart:yes:${name}`).setLabel(`Restart ${name}`).setStyle(ButtonStyle.Danger),
  );
  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: `Restart \`${name}\`? This stops and starts the container.`,
    components: [row],
  });
}

async function confirmRestart(interaction: ButtonInteraction, ctx: AppContext): Promise<void> {
  if (!canManage(interaction, ctx.env.ADMIN_ROLE_ID)) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'You do not have permission to restart containers.' });
    return;
  }
  if (interaction.channelId !== ctx.env.ADMIN_CHANNEL_ID) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Use /restart in <#${ctx.env.ADMIN_CHANNEL_ID}>.` });
    return;
  }
  const name = interaction.customId.slice('restart:yes:'.length);
  const allow = parseAllowlist(ctx.env.RESTART_ALLOWLIST);
  if (!isAllowed(allow, name) || !arcaneConfigured(ctx.env) || !ctx.env.ARCANE_URL || !ctx.env.ARCANE_API_KEY || !ctx.env.ARCANE_ENV_ID) {
    await interaction.update({ content: 'That restart is no longer allowed.', components: [] });
    return;
  }
  await interaction.deferUpdate();
  try {
    await new ArcaneClient(ctx.env.ARCANE_URL, ctx.env.ARCANE_API_KEY, ctx.env.ARCANE_ENV_ID).restart(name);
    const channel = await ctx.client.channels.fetch(ctx.env.ADMIN_CHANNEL_ID);
    if (channel?.isSendable()) {
      await channel.send({ content: `${interaction.user} restarted \`${name}\`.`, allowedMentions: { users: [interaction.user.id] } });
    }
    await interaction.editReply({ content: `Restarted \`${name}\`.`, components: [] });
  } catch (error) {
    await interaction.editReply({ content: failureText(error, 'Arcane could not restart that container.'), components: [] });
  }
}

async function unlinkMember(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!(await requireAdmin(interaction, ctx))) return;
  const user = interaction.options.getUser('user', true);
  const removed = ctx.db.unlink(user.id);
  const pending = ctx.db.denyPending(user.id);
  if (!removed && !pending) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'That member has no link and no pending request.' });
    return;
  }
  await dm(ctx, user.id, 'An admin removed your account link. Use /link-account if you still need to request something.');
  await interaction.reply({ flags: MessageFlags.Ephemeral, content: `Unlinked ${user.tag}.` });
}

async function alter(interaction: ButtonInteraction, ctx: AppContext): Promise<void> {
  if (!canManage(interaction, ctx.env.ADMIN_ROLE_ID)) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'You do not have permission to alter requests.' });
    return;
  }
  const requestId = Number(interaction.customId.split(':')[2]);
  const messageId = interaction.message.id;
  const channelId = interaction.channelId ?? ctx.env.ADMIN_CHANNEL_ID;
  try {
    const summary = await ctx.seerr.getRequest(requestId);
    if (summary.mediaType === 'movie') {
      await interaction.showModal(retitleModal(requestId, channelId, messageId));
      return;
    }
    if (summary.mediaType !== 'tv' || !summary.tmdbId) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'This request has no TV seasons to change.' });
      return;
    }
    const show = await ctx.seerr.getTv(summary.tmdbId);
    if (show.seasonNumbers.length === 0) {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'This show has no regular seasons.' });
      return;
    }
    const seasons = show.seasonNumbers.slice(0, 25);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`seerr:seasons:${requestId}:${channelId}:${messageId}`)
      .setPlaceholder('Seasons to approve')
      .setMinValues(1)
      .setMaxValues(seasons.length)
      .addOptions(seasons.map((season) => ({ label: `Season ${season}`, value: String(season) })));
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`seerr:retitle:${requestId}:${channelId}:${messageId}`).setLabel('Different title').setStyle(ButtonStyle.Secondary),
    );
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: show.seasonNumbers.length > 25 ? 'Pick the seasons to approve, then this request is approved. Only the first 25 seasons are listed.' : 'Pick the seasons to approve. That approves the request with just those seasons.',
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu), row],
    });
  } catch (error) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: failureText(error, 'Could not load that request.') });
  }
}

async function approveSeasons(interaction: StringSelectMenuInteraction, ctx: AppContext): Promise<void> {
  if (!canManage(interaction, ctx.env.ADMIN_ROLE_ID)) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'You do not have permission to alter requests.' });
    return;
  }
  const parsed = /^seerr:seasons:(\d+):(\d+):(\d+)$/.exec(interaction.customId);
  if (!parsed) return;
  const requestId = Number(parsed[1]);
  const channelId = parsed[2];
  const messageId = parsed[3];
  const seasons = interaction.values.map(Number).filter((season) => Number.isInteger(season) && season > 0);
  await interaction.deferUpdate();
  try {
    await ctx.seerr.updateSeasons(requestId, seasons);
    await ctx.seerr.approve(requestId);
    await markAdminMessage(ctx, channelId, messageId, `Approved by ${interaction.user.tag} · seasons ${seasons.join(', ')}`, GREEN);
    await interaction.editReply({ content: `Approved with seasons ${seasons.join(', ')}.`, components: [] });
  } catch (error) {
    await interaction.editReply({ content: failureText(error, 'Could not update that request.'), components: [] });
  }
}

async function showRetitle(interaction: ButtonInteraction, ctx: AppContext): Promise<void> {
  if (!canManage(interaction, ctx.env.ADMIN_ROLE_ID)) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'You do not have permission to alter requests.' });
    return;
  }
  const parsed = /^seerr:retitle:(\d+):(\d+):(\d+)$/.exec(interaction.customId);
  if (!parsed) return;
  await interaction.showModal(retitleModal(Number(parsed[1]), parsed[2], parsed[3]));
}

async function retitleSearch(interaction: ModalSubmitInteraction, ctx: AppContext): Promise<void> {
  if (!canManage(interaction, ctx.env.ADMIN_ROLE_ID)) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'You do not have permission to alter requests.' });
    return;
  }
  const parsed = /^seerr:retitle-modal:(\d+):(\d+):(\d+)$/.exec(interaction.customId);
  if (!parsed) return;
  const query = interaction.fields.getTextInputValue('query').trim();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const hits = dedupe(await ctx.seerr.search(query)).slice(0, 5);
    if (hits.length === 0) {
      await interaction.editReply('Nothing matched.');
      return;
    }
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`seerr:replace:${parsed[1]}:${parsed[2]}:${parsed[3]}`)
      .setPlaceholder('Replacement title')
      .addOptions(hits.map((hit) => ({
        label: clip(`${hit.title}${hit.year ? ` (${hit.year})` : ''}`, 100),
        description: hit.mediaType === 'movie' ? 'Movie' : 'TV',
        value: `${hit.mediaType}:${hit.mediaId}`,
      })));
    await interaction.editReply({
      content: 'Pick a replacement. The original request is declined and the new one is approved. A show is requested for all seasons.',
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
    });
  } catch (error) {
    await interaction.editReply(failureText(error, 'Seerr search failed.'));
  }
}

async function replaceRequest(interaction: StringSelectMenuInteraction, ctx: AppContext): Promise<void> {
  if (!canManage(interaction, ctx.env.ADMIN_ROLE_ID)) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'You do not have permission to alter requests.' });
    return;
  }
  const parsed = /^seerr:replace:(\d+):(\d+):(\d+)$/.exec(interaction.customId);
  const choice = /^(movie|tv):(\d+)$/.exec(interaction.values[0] ?? '');
  if (!parsed || !choice) return;
  const requestId = Number(parsed[1]);
  const channelId = parsed[2];
  const messageId = parsed[3];
  const mediaType = choice[1] as 'movie' | 'tv';
  const mediaId = Number(choice[2]);
  await interaction.deferUpdate();
  try {
    const original = await ctx.seerr.getRequest(requestId);
    if (!original.seerrUserId) {
      await interaction.editReply({ content: 'That request has no Seerr user, so it cannot be replaced.', components: [] });
      return;
    }
    const created = await ctx.seerr.createRequest({
      mediaType,
      mediaId,
      userId: original.seerrUserId,
      ...(mediaType === 'tv' ? { seasons: 'all' as const } : {}),
    });
    if (created.outcome !== 'created') {
      await interaction.editReply({ content: created.message, components: [] });
      return;
    }
    await ctx.seerr.approve(created.requestId);
    await ctx.seerr.decline(requestId);
    const option = interaction.component.options.find((item) => item.value === interaction.values[0]);
    await markAdminMessage(ctx, channelId, messageId, `Approved by ${interaction.user.tag} · replaced request ${requestId}`, GREEN, option?.label);
    await interaction.editReply({ content: `Approved the replacement and declined request ${requestId}.`, components: [] });
  } catch (error) {
    await interaction.editReply({ content: failureText(error, 'Could not replace that request.'), components: [] });
  }
}

function retitleModal(requestId: number, channelId: string, messageId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`seerr:retitle-modal:${requestId}:${channelId}:${messageId}`)
    .setTitle('Different title')
    .addLabelComponents(
      new LabelBuilder().setLabel('Search').setTextInputComponent(
        new TextInputBuilder().setCustomId('query').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200),
      ),
    );
}

async function markAdminMessage(
  ctx: AppContext,
  channelId: string,
  messageId: string,
  footer: string,
  color: number,
  title?: string,
): Promise<void> {
  const channel = await ctx.client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || !('messages' in channel)) return;
  const message = await channel.messages.fetch(messageId);
  const current = message.embeds[0];
  const embed = (current ? EmbedBuilder.from(current) : new EmbedBuilder()).setColor(color).setFooter({ text: footer });
  if (title) embed.setTitle(title);
  await message.edit({ embeds: [embed], components: [] });
}

async function loadTitle(
  ctx: AppContext,
  mediaType: 'movie' | 'tv' | undefined,
  tmdbId: number | undefined,
): Promise<{ title: string; year?: number; posterPath?: string } | undefined> {
  if (!mediaType || !tmdbId) return undefined;
  try {
    return mediaType === 'movie' ? await ctx.seerr.getMovie(tmdbId) : await ctx.seerr.getTv(tmdbId);
  } catch {
    return undefined;
  }
}

async function requireAdmin(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<boolean> {
  if (canManage(interaction, ctx.env.ADMIN_ROLE_ID)) return true;
  await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'You do not have permission to use that command.' });
  return false;
}

function streamLine(item: { user: string; title: string; quality: string; progress?: number; mode: string }): string {
  const progress = item.progress === undefined ? '' : ` · ${item.progress}%`;
  return `${item.user} — ${item.title} — ${item.quality}${progress} — ${item.mode}`;
}

function dedupe(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = `${hit.mediaType}:${hit.mediaId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
