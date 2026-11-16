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

export function loadEnv(): Env {
  loadDotEnv();
  const adminRole = process.env.ADMIN_ROLE_ID?.trim();
  const parsed = schema.safeParse({
    ...process.env,
    ADMIN_ROLE_ID: adminRole ? adminRole : undefined,
  });
  if (!parsed.success) {
    const names = parsed.error.issues.map((issue) => issue.path.join('.') || 'env').join(', ');
    throw new Error(`Invalid environment: ${names}`);
  }
  return parsed.data;
}
