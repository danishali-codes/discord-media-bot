import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import type { AppContext } from './context';
import { posterUrl, type MediaKind, type SeerrClient } from './seerr';

export type WebhookInput = {
  notificationType: string;
  event?: string;
  subject?: string;
  message?: string;
  image?: string;
  mediaType?: MediaKind;
  tmdbId?: number;
  requestId?: number;
  requesterName?: string;
};

/** Normalized Seerr notification. This is the object a future n8n step would receive. */
export type SeerrNotification = {
  notificationType: string;
  event?: string;
  message?: string;
  title: string;
  year?: number;
  posterUrl?: string;
  mediaType?: MediaKind;
  tmdbId?: number;
  requestId?: number;
  requesterName?: string;
  seerrUserId?: number;
};

const HANDLED = new Set([
  'MEDIA_PENDING',
  'MEDIA_APPROVED',
  'MEDIA_AUTO_APPROVED',
  'MEDIA_DECLINED',
  'MEDIA_AVAILABLE',
]);

export function parseSeerrWebhook(body: unknown): WebhookInput | undefined {
  const raw = asRecord(body);
  const notificationType = asString(raw?.notification_type);
  if (!raw || !notificationType) return undefined;
  const mediaType = asString(raw.media_type);
  return {
    notificationType,
    event: asString(raw.event),
    subject: asString(raw.subject),
    message: asString(raw.message),
    image: asString(raw.image),
    mediaType: mediaType === 'movie' || mediaType === 'tv' ? mediaType : undefined,
    tmdbId: positiveId(raw.media_tmdbid),
    requestId: positiveId(raw.request_id),
    requesterName: asString(raw.requestedBy_username),
  };
}

export async function enrichSeerrWebhook(input: WebhookInput, seerr: SeerrClient): Promise<SeerrNotification> {
  let mediaType = input.mediaType;
  let tmdbId = input.tmdbId;
  let requesterName = input.requesterName;
  let seerrUserId: number | undefined;

  if (input.requestId) {
    try {
      const request = await seerr.getRequest(input.requestId);
      seerrUserId = request.seerrUserId;
      requesterName = requesterName ?? request.requesterName;
      mediaType = mediaType ?? request.mediaType;
      tmdbId = tmdbId ?? request.tmdbId;
    } catch (error) {
      console.warn(`Could not load Seerr request ${input.requestId}: ${errorText(error)}`);
    }
  }

  let details: { title: string; year?: number; posterPath?: string } | undefined;
  if (mediaType && tmdbId) {
    try {
      details = mediaType === 'movie' ? await seerr.getMovie(tmdbId) : await seerr.getTv(tmdbId);
    } catch (error) {
      console.warn(`Could not load Seerr ${mediaType} ${tmdbId}: ${errorText(error)}`);
    }
  }

  const parsed = splitSubject(input.subject);
  return {
    notificationType: input.notificationType,
    event: input.event,
    message: input.message,
    title: details?.title ?? parsed.title,
    year: details?.year ?? parsed.year,
    posterUrl: posterUrl(details?.posterPath) ?? posterUrl(input.image),
    mediaType,
    tmdbId,
    requestId: input.requestId,
    requesterName,
    seerrUserId,
  };
}

/**
 * shortcut: Discord-only side effects, POST `event` to an n8n webhook here when that workflow is added.
 */
export async function dispatchSeerrEvent(event: SeerrNotification, ctx: AppContext): Promise<void> {
  if (!HANDLED.has(event.notificationType)) return;
  if (event.notificationType === 'MEDIA_PENDING') {
    await postPending(event, ctx);
    return;
  }
  await dmRequester(event, ctx);
}

async function postPending(event: SeerrNotification, ctx: AppContext): Promise<void> {
  const channel = await ctx.client.channels.fetch(ctx.env.ADMIN_CHANNEL_ID);
  if (!channel?.isSendable()) {
    throw new Error(`Admin channel ${ctx.env.ADMIN_CHANNEL_ID} is not sendable`);
  }
  const embed = new EmbedBuilder()
    .setTitle(event.title)
    .setColor(0xf0b429)
    .addFields(
      { name: 'Year', value: event.year ? String(event.year) : 'Unknown', inline: true },
      { name: 'Type', value: typeLabel(event.mediaType), inline: true },
      { name: 'Requested by', value: event.requesterName ?? 'Unknown', inline: true },
    );
  if (event.posterUrl) embed.setThumbnail(event.posterUrl);
  if (!event.requestId) {
    embed.setFooter({ text: 'The webhook had no request id, so Approve and Decline are unavailable.' });
  }

  const components = event.requestId
    ? [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`seerr:approve:${event.requestId}`)
            .setLabel('Approve')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`seerr:decline:${event.requestId}`)
            .setLabel('Decline')
            .setStyle(ButtonStyle.Danger),
        ),
      ]
    : [];

  await channel.send({
    embeds: [embed],
    components,
    allowedMentions: { parse: [] },
  });
}

async function dmRequester(event: SeerrNotification, ctx: AppContext): Promise<void> {
  const line = statusLine(event.notificationType);
  if (!line || !event.seerrUserId) return;
  const link = ctx.db.getBySeerr(event.seerrUserId);
  if (!link) return;
  try {
    const user = await ctx.client.users.fetch(link.discordId);
    const embed = new EmbedBuilder()
      .setTitle(event.title)
      .setDescription(line)
      .setColor(event.notificationType === 'MEDIA_DECLINED' ? 0xed4245 : 0x3ba55d);
    if (event.year) embed.addFields({ name: 'Year', value: String(event.year), inline: true });
    if (event.posterUrl) embed.setThumbnail(event.posterUrl);
    await user.send({ embeds: [embed] });
  } catch {
    console.warn('DM failed', link.discordId);
  }
}

function statusLine(notificationType: string): string | undefined {
  switch (notificationType) {
    case 'MEDIA_APPROVED':
      return 'Your request was approved.';
    case 'MEDIA_AUTO_APPROVED':
      return 'Your request was approved automatically.';
    case 'MEDIA_DECLINED':
      return 'Your request was declined.';
    case 'MEDIA_AVAILABLE':
      return 'This is now available.';
    default:
      return undefined;
  }
}

function typeLabel(mediaType: MediaKind | undefined): string {
  if (mediaType === 'tv') return 'TV';
  if (mediaType === 'movie') return 'Movie';
  return 'Unknown';
}

function splitSubject(subject?: string): { title: string; year?: number } {
  const text = subject?.trim() || 'Unknown title';
  const match = /^(.*) \((\d{4})\)$/.exec(text);
  if (!match?.[1]) return { title: text };
  const year = Number(match[2]);
  if (year < 1000 || year > 2999) return { title: text };
  return { title: match[1], year };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function positiveId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}
