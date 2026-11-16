import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';
import { autocompleteRestart, handleAdminCommand, handleAdminComponent } from './admin-commands';
import { canManage, dm, failureText } from './access';
import type { AppContext } from './context';
import type { PendingLink } from './db';
import { handleMemberCommand, handleMemberComponent } from './member-commands';
import { matchSeerrUser, type LinkService } from './match';
import { pickGo, pickLegacy, pickSeason, requestTitle } from './request-flow';
import { SeerrRequestError } from './seerr';

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
          'Run `/help` in the server for the other commands.',
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
  if (interaction.isAutocomplete() && interaction.commandName === 'restart') {
    return autocompleteRestart(interaction, ctx);
  }
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'link-account') return linkAccount(interaction, ctx);
    if (interaction.commandName === 'unlink-account') return unlinkAccount(interaction, ctx);
    if (interaction.commandName === 'request') return requestTitle(interaction, ctx);
    if (await handleMemberCommand(interaction, ctx)) return;
    if (await handleAdminCommand(interaction, ctx)) return;
    return;
  }
  if (await handleMemberComponent(interaction, ctx)) return;
  if (await handleAdminComponent(interaction, ctx)) return;
  if (interaction.isButton() && interaction.customId.startsWith('request:go:')) return pickGo(interaction, ctx);
  if (interaction.isStringSelectMenu() && interaction.customId === 'request:pick') return pickLegacy(interaction, ctx);
  if (interaction.isButton() && interaction.customId.startsWith('request:season:')) return pickSeason(interaction, ctx);
  if (interaction.isButton() && /^seerr:(approve|decline):/.test(interaction.customId)) return moderate(interaction, ctx);
  if (interaction.isButton() && interaction.customId.startsWith('link:')) return decideLink(interaction, ctx);
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

function keptEmbed(interaction: ButtonInteraction): EmbedBuilder {
  const current = interaction.message.embeds[0];
  return current ? EmbedBuilder.from(current) : new EmbedBuilder().setTitle('Request');
}

function serviceLabel(service: LinkService): string {
  return service === 'jellyfin' ? 'Jellyfin' : 'Plex';
}

