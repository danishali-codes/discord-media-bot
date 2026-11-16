import { N8N_TIMEOUT_MS } from './bots';

export type BotSend = {
  action: 'send';
  bot: string;
  message: string;
  thread: string | null;
  discordUserId: string;
  discordUsername: string;
  channelId: string;
};

export type BotPoll = { action: 'poll'; bot: string; thread: string };

type FetchImpl = typeof fetch;

export async function callBotWebhook(options: {
  url: string;
  secret?: string;
  body: BotSend | BotPoll;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (options.secret) headers.Authorization = options.secret;
  const fetchImpl: FetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(options.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs ?? N8N_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`n8n returned ${response.status}`);
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('n8n returned invalid json');
  }
}
