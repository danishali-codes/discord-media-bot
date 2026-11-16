const TMDB_POSTER = 'https://image.tmdb.org/t/p/w300';
const USER_PAGE_SIZE = 100;

export class SeerrRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'SeerrRequestError';
    this.status = status;
  }
}

export type MediaKind = 'movie' | 'tv';

export type SearchHit = {
  mediaType: MediaKind;
  mediaId: number;
  title: string;
  year?: number;
  posterPath?: string;
};

export type SeerrUser = {
  id: number;
  jellyfinUsername: string | null;
  plexUsername: string | null;
  displayName: string | null;
};

export type MovieDetails = {
  mediaId: number;
  title: string;
  year?: number;
  posterPath?: string;
  availability: 'available' | 'requested' | 'open';
};

export type TvDetails = {
  mediaId: number;
  title: string;
  year?: number;
  posterPath?: string;
  /** Regular seasons only. Specials (season 0) are left out. */
  seasonNumbers: number[];
};

export type SeerrRequestSummary = {
  id: number;
  seerrUserId?: number;
  requesterName?: string;
  mediaType?: MediaKind;
  tmdbId?: number;
};

export type CreateRequestInput = {
  mediaType: MediaKind;
  mediaId: number;
  userId: number;
  seasons?: number[] | 'all';
};

export type CreateRequestResult =
  | { outcome: 'created'; requestId: number }
  | { outcome: 'already'; message: string };

type FetchImpl = typeof fetch;

export function posterUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  const trimmed = path.trim();
  if (!trimmed || trimmed === 'null' || /\/null$/.test(trimmed)) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${TMDB_POSTER}${trimmed.startsWith('/') ? trimmed : `/${trimmed}`}`;
}

export function yearOf(date?: string | null): number | undefined {
  if (!date) return undefined;
  const match = /^(\d{4})/.exec(date);
  if (!match) return undefined;
  const year = Number(match[1]);
  if (year < 1000 || year > 2999) return undefined;
  return year;
}

export class SeerrClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchImpl;

  constructor(options: { baseUrl: string; apiKey: string; fetchImpl?: FetchImpl }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async search(query: string): Promise<SearchHit[]> {
    const { status, body } = await this.request(`/api/v1/search?query=${encodeURIComponent(query)}`);
    if (status !== 200) {
      throw new SeerrRequestError(status, messageOf(body, 'Seerr search failed'));
    }
    const results = asRecord(body)?.results;
    if (!Array.isArray(results)) return [];
    return results.flatMap((item) => {
      const hit = mapHit(item);
      return hit ? [hit] : [];
    });
  }

  async listUsers(): Promise<SeerrUser[]> {
    const byId = new Map<number, SeerrUser>();
    let skip = 0;

    for (let page = 0; page < 50; page += 1) {
      const { status, body } = await this.request(`/api/v1/user?take=${USER_PAGE_SIZE}&skip=${skip}`);
      if (status !== 200) {
        throw new SeerrRequestError(status, messageOf(body, 'Could not load Seerr users'));
      }
      const record = asRecord(body);
      const results = Array.isArray(record?.results) ? record.results : [];
      for (const item of results) {
        const user = mapUser(item);
        if (user) byId.set(user.id, user);
      }
      if (results.length < USER_PAGE_SIZE) break;
      const total = asId(asRecord(record?.pageInfo)?.results);
      skip += results.length;
      if (total !== undefined && skip >= total) break;
    }

    return [...byId.values()];
  }

  async getMovie(mediaId: number): Promise<MovieDetails> {
    const { status, body } = await this.request(`/api/v1/movie/${mediaId}`);
    if (status !== 200) {
      throw new SeerrRequestError(status, messageOf(body, 'Could not load that movie'));
    }
    const record = asRecord(body);
    if (!record) throw new SeerrRequestError(status, 'Could not load that movie');
    const mediaInfo = asRecord(record.mediaInfo);
    return {
      mediaId,
      title: asString(record.title) ?? asString(record.originalTitle) ?? `Movie ${mediaId}`,
      year: yearOf(asString(record.releaseDate)),
      posterPath: asString(record.posterPath),
      availability: availabilityOf(mediaInfo?.status),
    };
  }

  async getTv(mediaId: number): Promise<TvDetails> {
    const { status, body } = await this.request(`/api/v1/tv/${mediaId}`);
    if (status !== 200) {
      throw new SeerrRequestError(status, messageOf(body, 'Could not load that show'));
    }
    const record = asRecord(body);
    if (!record) throw new SeerrRequestError(status, 'Could not load that show');
    return {
      mediaId,
      title: asString(record.name) ?? asString(record.originalName) ?? `Show ${mediaId}`,
      year: yearOf(asString(record.firstAirDate)),
      posterPath: asString(record.posterPath),
      seasonNumbers: seasonNumbers(record.seasons),
    };
  }

  async getRequest(requestId: number): Promise<SeerrRequestSummary> {
    const { status, body } = await this.request(`/api/v1/request/${requestId}`);
    if (status !== 200) {
      throw new SeerrRequestError(status, messageOf(body, 'Could not load that request'));
    }
    const record = asRecord(body);
    const requestedBy = asRecord(record?.requestedBy);
    const media = asRecord(record?.media);
    const seerrUserId = asId(requestedBy?.id);
    return {
      id: requestId,
      seerrUserId: seerrUserId && seerrUserId > 0 ? seerrUserId : undefined,
      requesterName: asString(requestedBy?.displayName) ?? asString(requestedBy?.username),
      mediaType: asMediaKind(media?.mediaType),
      tmdbId: positiveId(media?.tmdbId),
    };
  }

  async createRequest(input: CreateRequestInput): Promise<CreateRequestResult> {
    const payload: Record<string, unknown> = {
      mediaType: input.mediaType,
      mediaId: input.mediaId,
      userId: input.userId,
    };
    if (input.seasons !== undefined) payload.seasons = input.seasons;

    const { status, body } = await this.request('/api/v1/request', { method: 'POST', body: payload });
    if (status === 200 || status === 201) {
      const requestId = positiveId(asRecord(body)?.id);
      if (!requestId) throw new SeerrRequestError(status, 'Seerr did not return a request id');
      return { outcome: 'created', requestId };
    }

    const message = messageOf(body, 'That has already been requested or is available.');
    if (isAlready(status, message)) return { outcome: 'already', message };
    throw new SeerrRequestError(status, messageOf(body, `Seerr returned ${status}`));
  }

  async approve(requestId: number): Promise<void> {
    await this.setStatus(requestId, 'approve');
  }

  async decline(requestId: number): Promise<void> {
    await this.setStatus(requestId, 'decline');
  }

  private async setStatus(requestId: number, action: 'approve' | 'decline'): Promise<void> {
    const { status, body } = await this.request(`/api/v1/request/${requestId}/${action}`, { method: 'POST' });
    if (status === 200) return;
    throw new SeerrRequestError(status, messageOf(body, `Could not ${action} that request`));
  }

  private async request(path: string, init?: { method?: string; body?: unknown }): Promise<{ status: number; body: unknown }> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Api-Key': this.apiKey,
    };
    const requestInit: RequestInit = { method: init?.method ?? 'GET', headers };
    if (init?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      requestInit.body = JSON.stringify(init.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl + path, requestInit);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'network error';
      throw new SeerrRequestError(0, `Could not reach Seerr: ${reason}`);
    }

    const text = await response.text();
    if (!text) return { status: response.status, body: undefined };
    try {
      return { status: response.status, body: JSON.parse(text) as unknown };
    } catch {
      return { status: response.status, body: { message: text.slice(0, 300) } };
    }
  }
}

function mapHit(value: unknown): SearchHit | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const mediaType = asMediaKind(raw.mediaType);
  const mediaId = positiveId(raw.id);
  if (!mediaType || !mediaId) return undefined;
  const title =
    mediaType === 'tv' ? asString(raw.name) ?? asString(raw.title) : asString(raw.title) ?? asString(raw.name);
  if (!title) return undefined;
  const date = mediaType === 'tv' ? asString(raw.firstAirDate) : asString(raw.releaseDate);
  return {
    mediaType,
    mediaId,
    title,
    year: yearOf(date),
    posterPath: asString(raw.posterPath),
  };
}

function mapUser(value: unknown): SeerrUser | undefined {
  const raw = asRecord(value);
  const id = positiveId(raw?.id);
  if (!raw || !id) return undefined;
  return {
    id,
    jellyfinUsername: asNullableString(raw.jellyfinUsername),
    plexUsername: asNullableString(raw.plexUsername),
    displayName: asNullableString(raw.displayName),
  };
}

function seasonNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const numbers = new Set<number>();
  for (const season of value) {
    const number = asId(asRecord(season)?.seasonNumber);
    if (number !== undefined && number > 0) numbers.add(number);
  }
  return [...numbers].sort((left, right) => left - right);
}

function availabilityOf(status: unknown): MovieDetails['availability'] {
  const name = typeof status === 'string' ? status.toUpperCase() : undefined;
  const code = typeof status === 'number' ? status : undefined;
  if (code === 4 || code === 5 || name === 'PARTIALLY_AVAILABLE' || name === 'AVAILABLE') return 'available';
  if (code === 2 || code === 3 || name === 'PENDING' || name === 'PROCESSING') return 'requested';
  return 'open';
}

function isAlready(status: number, message: string): boolean {
  if (status === 409 || status === 202) return true;
  return /already (requested|exists|available)|no seasons available/i.test(message);
}

function messageOf(body: unknown, fallback: string): string {
  return asString(asRecord(body)?.message) ?? fallback;
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

function asNullableString(value: unknown): string | null {
  return asString(value) ?? null;
}

function asId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function positiveId(value: unknown): number | undefined {
  const id = asId(value);
  return id !== undefined && id > 0 ? id : undefined;
}

function asMediaKind(value: unknown): MediaKind | undefined {
  return value === 'movie' || value === 'tv' ? value : undefined;
}
