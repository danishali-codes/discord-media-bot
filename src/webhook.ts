import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AppContext } from './context';
import { EmbedBuilder } from 'discord.js';
import { parseKumaWebhook } from './kuma';
import { dispatchSeerrEvent, enrichSeerrWebhook, parseSeerrWebhook } from './notifications';

const BODY_LIMIT = 1_000_000;

export function startWebhook(ctx: AppContext): Server {
  const server = createServer((req, res) => {
    handleRequest(req, res, ctx).catch((error) => {
      console.error('webhook failed', error);
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('webhook failed');
      }
    });
  });
  server.on('error', (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
  server.listen(ctx.env.WEBHOOK_PORT, '0.0.0.0', () => {
    console.log(`Webhook listening on ${ctx.env.WEBHOOK_PORT}`);
  });
  return server;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse, ctx: AppContext): Promise<void> {
  const path = req.url?.split('?')[0];
  if (req.method !== 'POST' || (path !== '/seerr-webhook' && path !== '/kuma-webhook')) {
    res.writeHead(404);
    res.end('not found');
    return;
  }

  const header = req.headers.authorization;
  const presented = Array.isArray(header) ? undefined : header;
  if (!secretMatches(presented, ctx.env.WEBHOOK_SECRET)) {
    res.writeHead(401);
    res.end('unauthorized');
    req.resume();
    return;
  }

  const raw = await readBody(req);
  if (raw === 'too-large') {
    res.writeHead(413);
    res.end('too large');
    return;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    res.writeHead(400);
    res.end('invalid json');
    return;
  }

  if (path === '/kuma-webhook') {
    await handleKuma(json, ctx, res);
    return;
  }

  const parsed = parseSeerrWebhook(json);
  if (!parsed) {
    res.writeHead(400);
    res.end('missing notification_type');
    return;
  }

  const event = await enrichSeerrWebhook(parsed, ctx.seerr);
  await dispatchSeerrEvent(event, ctx);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
}

async function handleKuma(json: unknown, ctx: AppContext, res: ServerResponse): Promise<void> {
  const alert = parseKumaWebhook(json);
  if (!alert) {
    res.writeHead(400);
    res.end('missing heartbeat');
    return;
  }
  if (alert.kind === 'ignore' || !ctx.env.STATUS_CHANNEL_ID) {
    if (alert.kind !== 'ignore' && !ctx.env.STATUS_CHANNEL_ID) {
      console.warn('STATUS_CHANNEL_ID is unset; skipping Kuma alert');
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  const channel = await ctx.client.channels.fetch(ctx.env.STATUS_CHANNEL_ID);
  if (channel?.isSendable()) {
    const down = alert.kind === 'down';
    const embed = new EmbedBuilder()
      .setColor(down ? 0xed4245 : 0x3ba55d)
      .setTitle(down ? `Down: ${alert.name}` : `Back up: ${alert.name}`);
    if (alert.message) embed.setDescription(alert.message);
    await channel.send({ embeds: [embed] });
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end('{"ok":true}');
}

function secretMatches(presented: string | undefined, secret: string): boolean {
  if (!presented) return false;
  const given = Buffer.from(presented);
  const expected = Buffer.from(secret);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}

async function readBody(req: IncomingMessage): Promise<string | 'too-large'> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > BODY_LIMIT) return 'too-large';
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}
