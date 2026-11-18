import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
  type Message,
} from 'discord.js';
import { canManage, failureText } from './access';
import type { AppContext } from './context';

export const PURGE_MAX = 1000;
export const PURGE_MAX_DAYS = 30;
// Discord only bulk-deletes messages younger than 14 days. Keep a small margin.
const BULK_WINDOW_MS = 14 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PurgeSpec = {
  mode: 'count' | 'days';
  amount: number;
  userId?: string;
  pinned: boolean;
};

type Candidate = { id: string; createdTimestamp: number; pinned: boolean; authorId: string };

export function encodePurge(spec: PurgeSpec): string {
  return `purge:yes:${spec.mode}:${spec.amount}:${spec.userId ?? '-'}:${spec.pinned ? 1 : 0}`;
}

export function decodePurge(customId: string): PurgeSpec | undefined {
  const parts = customId.split(':');
  if (parts.length !== 6 || parts[0] !== 'purge' || parts[1] !== 'yes') return undefined;
  const mode = parts[2];
  const amount = Number(parts[3]);
  if (mode !== 'count' && mode !== 'days') return undefined;
  if (!Number.isInteger(amount) || amount < 1) return undefined;
  if (mode === 'count' && amount > PURGE_MAX) return undefined;
  if (mode === 'days' && amount > PURGE_MAX_DAYS) return undefined;
  const userId = parts[4] === '-' ? undefined : parts[4];
  if (userId !== undefined && !/^\d{5,25}$/.test(userId)) return undefined;
  return { mode, amount, userId, pinned: parts[5] === '1' };
}

/**
 * Walks one page of messages (newest first) and returns the ones to delete.
 * `done` is true once the count is reached or the page goes past the cutoff.
 */
export function selectPage(
  page: Candidate[],
  spec: PurgeSpec,
  already: number,
  now: number,
): { picked: Candidate[]; done: boolean } {
  const picked: Candidate[] = [];
  const cutoff = spec.mode === 'days' ? now - spec.amount * DAY_MS : undefined;
  for (const message of page) {
    if (cutoff !== undefined && message.createdTimestamp < cutoff) return { picked, done: true };
    if (message.pinned && !spec.pinned) continue;
    if (spec.userId && message.authorId !== spec.userId) continue;
    picked.push(message);
    const total = already + picked.length;
    if (spec.mode === 'count' && total >= spec.amount) return { picked, done: true };
    if (total >= PURGE_MAX) return { picked, done: true };
  }
  return { picked, done: false };
}

export function splitByAge<T extends { createdTimestamp: number }>(messages: T[], now: number): { bulk: T[]; single: T[] } {
  const bulk: T[] = [];
  const single: T[] = [];
  for (const message of messages) (now - message.createdTimestamp < BULK_WINDOW_MS ? bulk : single).push(message);
  return { bulk, single };
}

export function describeSpec(spec: PurgeSpec): string {
  const scope = spec.mode === 'count' ? `the last ${spec.amount} messages` : `messages from the last ${spec.amount} day${spec.amount === 1 ? '' : 's'}`;
  const who = spec.userId ? ` by <@${spec.userId}>` : '';
  const pins = spec.pinned ? ', pinned included' : ', pinned kept';
  return `${scope}${who}${pins}`;
}

export async function purgeCommand(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!canPurge(interaction, ctx)) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'You do not have permission to delete messages here.' });
    return;
  }
  const channel = interaction.channel;
  if (!interaction.inGuild() || !channel || channel.isDMBased()) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Use /purge in a server channel.' });
    return;
  }
  const missing = botMissing(interaction);
  if (missing) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: `I need ${missing} in this channel first.` });
    return;
  }

  const count = interaction.options.getInteger('count');
  const days = interaction.options.getInteger('days');
  if ((count === null) === (days === null)) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Give either `count` or `days`, not both.' });
    return;
  }
  const spec: PurgeSpec = {
    mode: count !== null ? 'count' : 'days',
    amount: count ?? days ?? 0,
    userId: interaction.options.getUser('user')?.id,
    pinned: interaction.options.getBoolean('include_pinned') ?? false,
  };

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const found = await collect(channel as GuildTextBasedChannel, spec);
    if (found.length === 0) {
      await interaction.editReply('Nothing matches, so there is nothing to delete.');
      return;
    }
    const { single } = splitByAge(found, Date.now());
    const slow = single.length > 0 ? `\n${single.length} of them are older than 14 days and get deleted one at a time, which is slower.` : '';
    const capped = found.length >= PURGE_MAX ? `\nCapped at ${PURGE_MAX} per run.` : '';
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(encodePurge(spec)).setLabel(`Delete ${found.length}`).setStyle(ButtonStyle.Danger),
    );
    await interaction.editReply({
      content: `Delete ${found.length} message${found.length === 1 ? '' : 's'} in <#${channel.id}> (${describeSpec(spec)})? This cannot be undone.${slow}${capped}`,
      components: [row],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    await interaction.editReply(failureText(error, 'Could not read this channel.'));
  }
}

export async function confirmPurge(interaction: ButtonInteraction, ctx: AppContext): Promise<void> {
  if (!canPurge(interaction, ctx)) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'You do not have permission to delete messages here.' });
    return;
  }
  const spec = decodePurge(interaction.customId);
  const channel = interaction.channel;
  if (!spec || !interaction.inGuild() || !channel || channel.isDMBased()) {
    await interaction.update({ content: 'That purge is no longer valid. Run /purge again.', components: [] });
    return;
  }
  await interaction.update({ content: 'Deleting…', components: [] });
  try {
    const text = channel as GuildTextBasedChannel;
    const found = await collect(text, spec);
    const now = Date.now();
    const { bulk, single } = splitByAge(found, now);
    let deleted = 0;
    for (let i = 0; i < bulk.length; i += 100) {
      const ids = bulk.slice(i, i + 100).map((message) => message.id);
      if (ids.length === 1) {
        await text.messages.delete(ids[0]);
        deleted += 1;
      } else {
        const gone = await text.bulkDelete(ids, true);
        deleted += gone.size;
      }
    }
    for (const message of single) {
      try {
        await text.messages.delete(message.id);
        deleted += 1;
      } catch {
        // Already gone or not deletable; skip it.
      }
    }
    console.log(`purge: ${interaction.user.tag} deleted ${deleted} in #${text.name} (${describeSpec(spec)})`);
    await interaction.editReply({
      content: `Deleted ${deleted} message${deleted === 1 ? '' : 's'} (${describeSpec(spec)}).`,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    await interaction.editReply(failureText(error, 'Could not delete those messages.'));
  }
}

async function collect(channel: GuildTextBasedChannel, spec: PurgeSpec): Promise<Message[]> {
  const out: Message[] = [];
  const now = Date.now();
  let before: string | undefined;
  for (;;) {
    const page = await channel.messages.fetch({ limit: 100, before, cache: false });
    if (page.size === 0) break;
    const all = [...page.values()];
    const messages = all.filter((message) => !message.system);
    const byId = new Map(messages.map((message) => [message.id, message]));
    const { picked, done } = selectPage(
      messages.map((message) => ({
        id: message.id,
        createdTimestamp: message.createdTimestamp,
        pinned: message.pinned,
        authorId: message.author.id,
      })),
      spec,
      out.length,
      now,
    );
    for (const candidate of picked) {
      const message = byId.get(candidate.id);
      if (message) out.push(message);
    }
    if (done || page.size < 100) break;
    before = all[all.length - 1].id;
  }
  return out;
}

function canPurge(interaction: ChatInputCommandInteraction | ButtonInteraction, ctx: AppContext): boolean {
  if (!canManage(interaction, ctx.env.ADMIN_ROLE_ID)) return false;
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ?? false;
}

function botMissing(interaction: ChatInputCommandInteraction): string | undefined {
  const perms = interaction.appPermissions;
  if (!perms.has(PermissionFlagsBits.ViewChannel) || !perms.has(PermissionFlagsBits.ReadMessageHistory)) {
    return 'View Channel and Read Message History';
  }
  if (!perms.has(PermissionFlagsBits.ManageMessages)) return 'Manage Messages';
  return undefined;
}
