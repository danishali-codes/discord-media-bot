import { EmbedBuilder } from 'discord.js';
import type { AppContext } from './context';
import { JellyfinClient, jellyfinConfigured } from './jellyfin';
import { classifyActivity, type ActivityHit } from './library';
import { collectNew } from './new-media';
import { newEmbed } from './present';
import { DEFAULT_WEEKLY_CRON, DUBAI, isScheduleDue, parseCron } from './schedule';
import { matchTautulliUser, TautulliClient, tautulliConfigured } from './tautulli';

const WEEKLY = 'weekly-new';
const INACTIVE = 'weekly-inactive';
let running = false;

export function startJobs(ctx: AppContext): void {
  if (ctx.env.NEW_THIS_WEEK_CRON && !parseCron(ctx.env.NEW_THIS_WEEK_CRON)) {
    console.warn('NEW_THIS_WEEK_CRON is invalid; using Sunday 20:00 Asia/Dubai');
  }
  const timer = setInterval(() => {
    void runJobs(ctx);
  }, 30_000);
  timer.unref();
}

async function runJobs(ctx: AppContext): Promise<void> {
  if (running) return;
  running = true;
  try {
    const slot = parseCron(ctx.env.NEW_THIS_WEEK_CRON) ?? parseCron(DEFAULT_WEEKLY_CRON);
    if (!slot) return;
    const now = new Date();
    await runOnce(ctx, WEEKLY, slot, now, () => postNewThisWeek(ctx));
    await runOnce(ctx, INACTIVE, slot, now, () => postInactive(ctx));
  } finally {
    running = false;
  }
}

async function runOnce(
  ctx: AppContext,
  name: string,
  slot: NonNullable<ReturnType<typeof parseCron>>,
  now: Date,
  work: () => Promise<void>,
): Promise<void> {
  const due = isScheduleDue(slot, now, DUBAI, ctx.db.getStamp(name));
  if (!due.due) return;
  ctx.db.setStamp(name, due.key);
  try {
    await work();
  } catch (error) {
    console.error(`${name} failed`, error);
  }
}

async function postNewThisWeek(ctx: AppContext): Promise<void> {
  if (!ctx.env.ANNOUNCE_CHANNEL_ID) return;
  const channel = await ctx.client.channels.fetch(ctx.env.ANNOUNCE_CHANNEL_ID);
  if (!channel?.isSendable()) return;
  const items = await collectNew(ctx.env, ctx.seerr, 7);
  if (items.length === 0) return;
  await channel.send({
    content: 'New this week',
    embeds: items.slice(0, 8).map(newEmbed),
  });
}

async function postInactive(ctx: AppContext): Promise<void> {
  const days = ctx.env.INACTIVE_DAYS;
  const jellyfinOn = jellyfinConfigured(ctx.env);
  const tautulliOn = tautulliConfigured(ctx.env);
  if (!jellyfinOn && !tautulliOn) return;
  const channel = await ctx.client.channels.fetch(ctx.env.ADMIN_CHANNEL_ID);
  if (!channel?.isSendable()) return;

  const jellyfinUsers =
    jellyfinOn && ctx.env.JELLYFIN_URL && ctx.env.JELLYFIN_API_KEY
      ? await new JellyfinClient(ctx.env.JELLYFIN_URL, ctx.env.JELLYFIN_API_KEY).users()
      : [];
  const tautulliUsers = tautulliOn && ctx.env.TAUTULLI_URL && ctx.env.TAUTULLI_API_KEY
    ? await new TautulliClient(ctx.env.TAUTULLI_URL, ctx.env.TAUTULLI_API_KEY).users()
    : [];
  const now = new Date();
  const inactive: string[] = [];
  for (const link of ctx.db.listLinks()) {
    const hits: ActivityHit[] = [];
    if (tautulliOn) {
      const user = matchTautulliUser(tautulliUsers, link.username);
      hits.push(user ? { matched: true, at: user.last } : { matched: false });
    }
    if (jellyfinOn) {
      const user = jellyfinUsers.find((item) => item.name.toLowerCase() === link.username.toLowerCase());
      hits.push(user ? { matched: true, at: user.last } : { matched: false });
    }
    if (classifyActivity(hits, now, days) === 'inactive') inactive.push(link.discordId);
  }
  if (inactive.length === 0) return;
  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle(`No activity in ${days} days`)
    .setDescription(inactive.map((id) => `<@${id}>`).join('\n').slice(0, 4000));
  await channel.send({ embeds: [embed], allowedMentions: { users: inactive.slice(0, 100) } });
}
