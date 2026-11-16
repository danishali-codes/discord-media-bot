import { asNumber, asRecord, asString, positiveId } from './http';

export type RequestStatusName = 'pending' | 'approved' | 'declined' | 'unknown';
export type MediaStatusName = 'processing' | 'partial' | 'available' | 'unknown';
export type LibraryState = 'available' | 'partial' | 'requested' | 'absent';

export type UserRequest = {
  id: number;
  createdAt?: string;
  mediaType?: 'movie' | 'tv';
  tmdbId?: number;
  tvdbId?: number;
  title?: string;
  year?: number;
  requestStatus: RequestStatusName;
  mediaStatus: MediaStatusName;
};

const DUBAI = 'Asia/Dubai';

export function mapRequestStatus(value: unknown): RequestStatusName {
  const name = typeof value === 'string' ? value.trim().toUpperCase() : undefined;
  const code = asNumber(value);
  if (code === 1 || name === 'PENDING' || name === 'PENDING_APPROVAL') return 'pending';
  if (code === 2 || name === 'APPROVED') return 'approved';
  if (code === 3 || name === 'DECLINED') return 'declined';
  return 'unknown';
}

export function mapMediaStatus(value: unknown): MediaStatusName {
  const name = typeof value === 'string' ? value.trim().toUpperCase() : undefined;
  const code = asNumber(value);
  if (code === 5 || name === 'AVAILABLE') return 'available';
  if (code === 4 || name === 'PARTIALLY_AVAILABLE') return 'partial';
  if (code === 2 || code === 3 || name === 'PENDING' || name === 'PROCESSING') return 'processing';
  return 'unknown';
}

/** Search/library status. Partial stays distinct from fully available. */
export function libraryState(status: unknown): LibraryState {
  const media = mapMediaStatus(status);
  if (media === 'available') return 'available';
  if (media === 'partial') return 'partial';
  if (media === 'processing') return 'requested';
  const name = typeof status === 'string' ? status.trim().toUpperCase() : undefined;
  if (name === 'REQUESTED') return 'requested';
  return 'absent';
}

export function combinedStatus(
  request: RequestStatusName,
  media: MediaStatusName,
): { emoji: string; text: string } {
  if (request === 'pending') return { emoji: '⏳', text: 'Pending approval' };
  if (request === 'declined') return { emoji: '❌', text: 'Declined' };
  if (request === 'approved' && media === 'available') return { emoji: '✅', text: 'Approved · available' };
  if (request === 'approved' && media === 'partial') return { emoji: '🟡', text: 'Approved · partially available' };
  if (request === 'approved' && media === 'processing') return { emoji: '⬇️', text: 'Approved · downloading' };
  if (request === 'approved') return { emoji: '✅', text: 'Approved' };
  if (media === 'available') return { emoji: '✅', text: 'Available' };
  if (media === 'partial') return { emoji: '🟡', text: 'Partially available' };
  if (media === 'processing') return { emoji: '⬇️', text: 'Processing' };
  return { emoji: '❔', text: 'Unknown' };
}

export function libraryLabel(state: LibraryState | undefined): { emoji: string; text: string } {
  if (state === 'available') return { emoji: '✅', text: 'Available' };
  if (state === 'partial') return { emoji: '🟡', text: 'Partially available' };
  if (state === 'requested') return { emoji: '⏳', text: 'Requested/Processing' };
  return { emoji: '⬜', text: 'Not on the server' };
}

export function formatRequestedDate(iso?: string): string {
  if (!iso) return 'unknown date';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown date';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DUBAI,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatRequestLine(input: {
  title: string;
  year?: number;
  mediaType?: 'movie' | 'tv';
  requestedAt?: string;
  requestStatus: RequestStatusName;
  mediaStatus: MediaStatusName;
}): string {
  const status = combinedStatus(input.requestStatus, input.mediaStatus);
  const title = `${input.title}${input.year ? ` (${input.year})` : ''}`;
  const kind = input.mediaType === 'tv' ? 'TV' : input.mediaType === 'movie' ? 'Movie' : 'Media';
  return `${status.emoji} ${title} · ${kind} · ${formatRequestedDate(input.requestedAt)} · ${status.text}`;
}

export function requestMatches(title: string, query: string | undefined): boolean {
  const needle = query?.trim().toLowerCase();
  if (!needle) return true;
  return title.toLowerCase().includes(needle);
}

export function mapUserRequest(value: unknown): UserRequest | undefined {
  const raw = asRecord(value);
  const id = positiveId(raw?.id);
  if (!raw || !id) return undefined;
  const media = asRecord(raw.media);
  const mediaType = asMediaType(raw.type) ?? asMediaType(media?.mediaType) ?? asMediaType(raw.mediaType);
  return {
    id,
    createdAt: asString(raw.createdAt) ?? asString(raw.created),
    mediaType,
    tmdbId: positiveId(media?.tmdbId) ?? positiveId(raw.tmdbId),
    tvdbId: positiveId(media?.tvdbId) ?? positiveId(raw.tvdbId),
    title: asString(raw.title) ?? asString(media?.title) ?? asString(media?.name),
    year: yearFrom(raw.year) ?? yearFrom(media?.year),
    requestStatus: mapRequestStatus(raw.status),
    mediaStatus: mapMediaStatus(media?.status ?? raw.mediaStatus),
  };
}

function asMediaType(value: unknown): 'movie' | 'tv' | undefined {
  return value === 'movie' || value === 'tv' ? value : undefined;
}

function yearFrom(value: unknown): number | undefined {
  const year = asNumber(value);
  if (year === undefined || !Number.isInteger(year) || year < 1000 || year > 2999) return undefined;
  return year;
}
