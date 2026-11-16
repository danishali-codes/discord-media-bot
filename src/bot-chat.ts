import {
  MessageFlags,
  PermissionFlagsBits,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Message,
  type TextBasedChannel,
} from 'discord.js';
import {
  COOLDOWN_MS,
  POLL_EVERY_MS,
  POLL_LIMIT_MS,
  cooldownReady,
  findBot,
  isNewChatCommand,
  parseBotChannels,
  pollDecision,
  readBotResponse,
  splitDiscordMessage,
  type BotChannel,
  type BotTurn,
} from './bots';
import { canManage } from './access';
import type { AppContext } from './context';
import { callBotWebhook } from './n8n-bots';

const FRIENDLY_ERROR = "Couldn't reach the bots just now.";
const lastSent = new Map<string, number>();
const lanes = new Map<string, Promise<void>>();
const chatGeneration = new Map<string, number>();

export function registerBotChat(client: AppContext['client'], ctx: AppContext): void {
  if (!botChatEnabled(ctx)) return;
  client.on('messageCreate', (message) => {
    onChannelMessage(message, ctx).catch((error) => {
      console.error('bot chat failed', error instanceof Error ? error.message : error);
    });
  });
}

export async function autocompleteBots(interaction: AutocompleteInteraction, ctx: AppContext): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = parseBotChannels(ctx.env.BOT_CHANNELS)
    .filter((bot) => bot.name.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((bot) => ({ name: bot.name, value: bot.name }));
  await interaction.respond(choices);
}

export async function askBot(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!canManage(interaction, ctx.env.ADMIN_ROLE_ID)) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'You do not have permission to use that command.' });
    return;
  }
  const bots = parseBotChannels(ctx.env.BOT_CHANNELS);
  const bot = findBot(bots, interaction.options.getString('bot', true));
  const message = interaction.options.getString('message', true).trim();
  if (!ctx.env.N8N_BOTS_WEBHOOK_URL || bots.length === 0) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Bot chat is not configured.' });
    return;
  }
  if (!bot) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'That bot is not configured.' });
    return;
  }
  if (!message) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Enter a message.' });
    return;
  }
  const inHome = interaction.channelId === bot.channelId;
  if (coolingDown(interaction.user.id)) {
    await interaction.reply({
      ...(inHome ? {} : { flags: MessageFlags.Ephemeral }),
      content: 'Wait a few seconds before asking again.',
    });
    return;
  }
  if (inHome) await interaction.deferReply();
  else await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const run = () =>
    deliver(ctx, {
      bot,
      message,
      channelId: interaction.channelId,
      userId: interaction.user.id,
      username: interaction.user.username,
      continueThread: inHome,
      typing: () => (inHome ? typing(interaction.channel) : Promise.resolve()),
      send: async (text) => {
        const parts = splitDiscordMessage(text);
        if (parts.length === 0) return;
        await interaction.editReply(parts[0]);
        for (const part of parts.slice(1)) {
          await interaction.followUp(inHome ? part : { content: part, flags: MessageFlags.Ephemeral });
        }
      },
    });
  if (inHome) await enqueue(`${bot.name}:${bot.channelId}`, run);
  else await run();
}

export async function resetBot(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!canManage(interaction, ctx.env.ADMIN_ROLE_ID)) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'You do not have permission to use that command.' });
    return;
  }
  const bot = findBot(parseBotChannels(ctx.env.BOT_CHANNELS), interaction.options.getString('bot', true));
  if (!bot) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'That bot is not configured.' });
    return;
  }
  invalidate(bot.name);
  ctx.db.clearBotThreads(bot.name);
  const inHome = interaction.channelId === bot.channelId;
  await interaction.reply({
    ...(inHome ? {} : { flags: MessageFlags.Ephemeral }),
    content: `New chat with ${bot.name}.`,
  });
}

async function onChannelMessage(message: Message, ctx: AppContext): Promise<void> {
  if (!ctx.env.N8N_BOTS_WEBHOOK_URL || message.author.bot || message.guildId !== ctx.env.DISCORD_GUILD_ID) return;
  const bot = parseBotChannels(ctx.env.BOT_CHANNELS).find((item) => item.channelId === message.channelId);
  if (!bot) return;
  const content = message.content?.trim() ?? '';
  if (!content) return;
  if (!messageIsAdmin(message, ctx.env.ADMIN_ROLE_ID)) {
    await message.react('⛔').catch(() => undefined);
    return;
  }
  if (isNewChatCommand(content)) {
    invalidate(bot.name);
    ctx.db.clearBotThreads(bot.name, message.channelId);
    await message.reply(`New chat with ${bot.name}.`);
    return;
  }
  if (coolingDown(message.author.id)) {
    await message.react('⏳').catch(() => undefined);
    return;
  }
  await enqueue(`${bot.name}:${bot.channelId}`, () =>
    deliver(ctx, {
      bot,
      message: content,
      channelId: message.channelId,
      userId: message.author.id,
      username: message.author.username,
      continueThread: true,
      typing: () => typing(message.channel),
      send: async (text) => {
        const parts = splitDiscordMessage(text);
        if (parts.length === 0) return;
        await message.reply(parts[0]);
        if (!message.channel.isSendable()) return;
        for (const part of parts.slice(1)) await message.channel.send(part);
      },
    }),
  );
}

async function deliver(
  ctx: AppContext,
  input: {
    bot: BotChannel;
    message: string;
    channelId: string;
    userId: string;
    username: string;
    continueThread: boolean;
    typing: () => Promise<void>;
    send: (text: string) => Promise<void>;
  },
): Promise<void> {
  const url = ctx.env.N8N_BOTS_WEBHOOK_URL;
  if (!url) return;
  await reserveCooldown(input.userId);
  const generation = chatGeneration.get(input.bot.name) ?? 0;
  let expected = input.continueThread ? (ctx.db.getBotThread(input.bot.name, input.channelId) ?? null) : null;
  try {
    await input.typing();
    const first = await callBotWebhook({
      url,
      secret: ctx.env.N8N_BOTS_SECRET,
      body: {
        action: 'send',
        bot: input.bot.name,
        message: input.message,
        thread: expected,
        discordUserId: input.userId,
        discordUsername: input.username,
        channelId: input.channelId,
      },
    });
    const turn = await waitForReply(ctx, input.bot.name, url, first, input.typing, (thread) => {
      if (!input.continueThread || (chatGeneration.get(input.bot.name) ?? 0) !== generation) return;
      expected = remember(ctx, input.bot.name, input.channelId, thread, expected);
    });
    await input.send(textFor(input.bot.name, turn));
  } catch (error) {
    console.error('bot chat failed', error instanceof Error ? error.message : error);
    await input.send(FRIENDLY_ERROR).catch(() => undefined);
  }
}

async function waitForReply(
  ctx: AppContext,
  bot: string,
  url: string,
  first: unknown,
  typing: () => Promise<void>,
  rememberThread: (thread: string | undefined) => void,
): Promise<BotTurn | { type: 'timeout' }> {
  let turn = readBotResponse(first);
  rememberThread(threadOf(turn));
  const started = Date.now();
  while (turn.type === 'working') {
    const elapsed = Date.now() - started;
    if (pollDecision(elapsed) === 'timeout') return { type: 'timeout' };
    await sleep(Math.min(POLL_EVERY_MS, POLL_LIMIT_MS - elapsed));
    if (pollDecision(Date.now() - started) === 'timeout') return { type: 'timeout' };
    await typing();
    const body = await callBotWebhook({
      url,
      secret: ctx.env.N8N_BOTS_SECRET,
      body: { action: 'poll', bot, thread: turn.thread },
    });
    turn = readBotResponse(body);
    rememberThread(threadOf(turn));
  }
  return turn;
}

function threadOf(turn: BotTurn): string | undefined {
  return 'thread' in turn ? turn.thread : undefined;
}

function textFor(bot: string, turn: BotTurn | { type: 'timeout' }): string {
  if (turn.type === 'reply') return turn.text;
  if (turn.type === 'needs_approval') return `⚠️ ${bot} needs approval in the MausBot app`;
  if (turn.type === 'timeout') return 'Still working, check MausBot';
  return `No reply from ${bot}.`;
}

function remember(ctx: AppContext, bot: string, channelId: string, thread: string | undefined, expected: string | null): string | null {
  if (!thread) return expected;
  const current = ctx.db.getBotThread(bot, channelId) ?? null;
  if (current !== expected) return current;
  ctx.db.setBotThread(bot, channelId, thread);
  return thread;
}

function enqueue(key: string, job: () => Promise<void>): Promise<void> {
  const previous = lanes.get(key) ?? Promise.resolve();
  const next = previous.then(job, job);
  lanes.set(key, next.then(() => undefined, () => undefined));
  return next;
}

function coolingDown(userId: string): boolean {
  return !cooldownReady(lastSent.get(userId), Date.now());
}

async function reserveCooldown(userId: string): Promise<void> {
  const last = lastSent.get(userId);
  const now = Date.now();
  if (!cooldownReady(last, now)) await sleep(COOLDOWN_MS - (now - (last ?? now)));
  lastSent.set(userId, Date.now());
}

function invalidate(bot: string): void {
  chatGeneration.set(bot, (chatGeneration.get(bot) ?? 0) + 1);
}

async function typing(channel: TextBasedChannel | null): Promise<void> {
  if (channel && 'sendTyping' in channel) await channel.sendTyping();
}

function botChatEnabled(ctx: AppContext): boolean {
  return Boolean(ctx.env.N8N_BOTS_WEBHOOK_URL && parseBotChannels(ctx.env.BOT_CHANNELS).length > 0);
}

function messageIsAdmin(message: Message, adminRoleId: string | undefined): boolean {
  if (message.member?.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  if (!adminRoleId || !message.member) return false;
  return message.member.roles.cache.has(adminRoleId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
