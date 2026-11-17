import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';

const schema = z.object({
  DISCORD_TOKEN: z.string().trim().min(1),
  DISCORD_CLIENT_ID: z.string().trim().min(1),
  DISCORD_GUILD_ID: z.string().trim().min(1),
  ADMIN_CHANNEL_ID: z.string().trim().min(1),
  REQUESTS_CHANNEL_ID: z.string().trim().min(1),
  SEERR_URL: z.url(),
  SEERR_API_KEY: z.string().trim().min(1),
  WEBHOOK_SECRET: z.string().trim().min(1),
  WEBHOOK_PORT: z.coerce.number().int().positive(),
  ADMIN_ROLE_ID: z.string().trim().min(1).optional(),
  JELLYFIN_URL: z.url().optional(),
  JELLYFIN_API_KEY: z.string().trim().min(1).optional(),
  JELLYFIN_PUBLIC_URL: z.url().optional(),
  PLEX_PUBLIC_URL: z.url().optional(),
  SEERR_PUBLIC_URL: z.url().optional(),
  STATUS_PAGE_URL: z.url().optional(),
  LINKS_EXTRA: z.string().trim().min(1).optional(),
  UPTIME_KUMA_URL: z.url().optional(),
  UPTIME_KUMA_STATUS_SLUG: z.string().trim().min(1).optional(),
  STATUS_CHANNEL_ID: z.string().trim().min(1).optional(),
  ANNOUNCE_CHANNEL_ID: z.string().trim().min(1).optional(),
  SONARR_URL: z.url().optional(),
  SONARR_API_KEY: z.string().trim().min(1).optional(),
  TAUTULLI_URL: z.url().optional(),
  TAUTULLI_API_KEY: z.string().trim().min(1).optional(),
  BESZEL_URL: z.url().optional(),
  BESZEL_EMAIL: z.string().trim().min(1).optional(),
  BESZEL_PASSWORD: z.string().trim().min(1).optional(),
  ARCANE_URL: z.url().optional(),
  ARCANE_API_KEY: z.string().trim().min(1).optional(),
  ARCANE_ENV_ID: z.string().trim().min(1).optional(),
  RESTART_ALLOWLIST: z.string().trim().min(1).optional(),
  NEW_THIS_WEEK_CRON: z.string().trim().min(1).optional(),
  INACTIVE_DAYS: z.coerce.number().int().positive().default(60),
  DECLINE_DM_MAX_AGE_DAYS: z.coerce.number().int().positive().default(14),
  N8N_BOTS_WEBHOOK_URL: z.url().optional(),
  N8N_BOTS_SECRET: z.string().trim().min(1).optional(),
  BOT_CHANNELS: z.string().trim().min(1).optional(),
});

export type Env = z.infer<typeof schema>;

function loadDotEnv(file = '.env'): void {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const OPTIONAL = [
  'ADMIN_ROLE_ID',
  'JELLYFIN_URL',
  'JELLYFIN_API_KEY',
  'JELLYFIN_PUBLIC_URL',
  'PLEX_PUBLIC_URL',
  'SEERR_PUBLIC_URL',
  'STATUS_PAGE_URL',
  'LINKS_EXTRA',
  'UPTIME_KUMA_URL',
  'UPTIME_KUMA_STATUS_SLUG',
  'STATUS_CHANNEL_ID',
  'ANNOUNCE_CHANNEL_ID',
  'SONARR_URL',
  'SONARR_API_KEY',
  'TAUTULLI_URL',
  'TAUTULLI_API_KEY',
  'BESZEL_URL',
  'BESZEL_EMAIL',
  'BESZEL_PASSWORD',
  'ARCANE_URL',
  'ARCANE_API_KEY',
  'ARCANE_ENV_ID',
  'RESTART_ALLOWLIST',
  'NEW_THIS_WEEK_CRON',
  'INACTIVE_DAYS',
  'DECLINE_DM_MAX_AGE_DAYS',
  'N8N_BOTS_WEBHOOK_URL',
  'N8N_BOTS_SECRET',
  'BOT_CHANNELS',
] as const;

export function loadEnv(): Env {
  loadDotEnv();
  const input: Record<string, string | undefined> = { ...process.env };
  for (const key of OPTIONAL) {
    const value = input[key]?.trim();
    input[key] = value ? value : undefined;
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join('.') || 'env').join(', ');
    throw new Error(`Invalid environment: ${names}`);
  }
  return parsed.data;
}
