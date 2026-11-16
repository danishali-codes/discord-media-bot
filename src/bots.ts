import { asRecord, asString } from './http';

export type BotChannel = { name: string; channelId: string };

export type BotTurn =
  | { type: 'reply'; text: string; thread?: string }
  | { type: 'working'; thread: string }
  | { type: 'needs_approval'; thread?: string }
  | { type: 'empty' };

export const POLL_EVERY_MS = 10_000;
export const POLL_LIMIT_MS = 5 * 60 * 1000;
export const N8N_TIMEOUT_MS = 70_000;
export const COOLDOWN_MS = 6_000;
export const DISCORD_LIMIT = 2000;

const FENCE = /^(```[A-Za-z0-9_+-]{0,20})$/;

/** shortcut: first comma-separated `name:channelId` wins; later duplicates of that name or channel are dropped. */
export function parseBotChannels(raw: string | undefined): BotChannel[] {
  if (!raw?.trim()) return [];
  const names = new Set<string>();
  const channels = new Set<string>();
  const bots: BotChannel[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    const colon = trimmed.indexOf(':');
    if (colon <= 0) continue;
    const name = trimmed.slice(0, colon).trim();
    const channelId = trimmed.slice(colon + 1).trim();
    if (!name || !/^\d{5,22}$/.test(channelId)) continue;
    const key = name.toLowerCase();
    if (names.has(key) || channels.has(channelId)) continue;
    names.add(key);
    channels.add(channelId);
    bots.push({ name, channelId });
  }
  return bots;
}

export function findBot(bots: readonly BotChannel[], name: string): BotChannel | undefined {
  const key = name.trim().toLowerCase();
  return bots.find((bot) => bot.name.toLowerCase() === key);
}

export function isNewChatCommand(content: string): boolean {
  return content.trim() === '!new';
}

export function readBotResponse(body: unknown): BotTurn {
  const raw = asRecord(body);
  if (!raw) return { type: 'empty' };
  const thread = threadOf(raw.thread);
  const reply = asString(raw.reply);
  if (reply) return { type: 'reply', text: reply, ...(thread ? { thread } : {}) };
  const status = asString(raw.status)?.toLowerCase();
  if (status === 'needs_approval') return { type: 'needs_approval', ...(thread ? { thread } : {}) };
  if (status === 'working' && thread) return { type: 'working', thread };
  return { type: 'empty' };
}

export function pollDecision(elapsedMs: number, limitMs = POLL_LIMIT_MS): 'continue' | 'timeout' {
  return elapsedMs >= limitMs ? 'timeout' : 'continue';
}

export function cooldownReady(lastAt: number | undefined, now: number, gapMs = COOLDOWN_MS): boolean {
  return lastAt === undefined || now - lastAt >= gapMs;
}

export function splitDiscordMessage(text: string, limit = DISCORD_LIMIT): string[] {
  if (text.length === 0) return [];
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  let carry: string | undefined;

  while (rest.length > 0) {
    const prefix = carry ? `${carry}\n` : '';
    const room = limit - prefix.length - (carry ? 4 : 0);
    if (room < 1) {
      chunks.push(prefix.slice(0, limit));
      carry = undefined;
      continue;
    }
    if (rest.length <= room) {
      const piece = prefix + rest;
      const open = unclosedFence(piece);
      chunks.push(open ? closeFence(piece, limit) : piece);
      break;
    }

    let cut = rest.lastIndexOf('\n', room);
    if (cut < Math.floor(room / 2)) cut = room;
    if (cut < 1) cut = 1;
    const piece = rest.slice(0, cut);
    rest = rest.slice(cut).replace(/^\n/, '');
    const combined = prefix + piece;
    const open = unclosedFence(combined);
    if (open) {
      chunks.push(closeFence(combined, limit));
      carry = open;
    } else {
      chunks.push(combined);
      carry = undefined;
    }
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

function closeFence(text: string, limit: number): string {
  const closed = text.endsWith('\n') ? `${text}\`\`\`` : `${text}\n\`\`\``;
  return closed.length <= limit ? closed : closed.slice(0, limit);
}

function unclosedFence(text: string): string | undefined {
  let open: string | undefined;
  for (const line of text.split('\n')) {
    const marker = FENCE.exec(line.trim())?.[1];
    if (!marker) continue;
    open = open ? undefined : marker;
  }
  return open;
}

function threadOf(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return asString(value);
}
