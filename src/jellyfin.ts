import type { RawNewItem } from './library';
import { asNumber, asRecord, asString, positiveId, requestJson } from './http';

export type JellyfinItem = {
  id: string;
  title: string;
  year?: number;
  overview?: string;
  tmdbId?: number;
  kind: 'movie' | 'show';
};

export type JellyfinSession = {
  user: string;
  title: string;
  quality: string;
  progress?: number;
  mode: 'Transcode' | 'Direct play';
};

export type JellyfinActivity = { name: string; last?: Date };

type FetchImpl = typeof fetch;

export class JellyfinClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchImpl = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async recent(since: Date): Promise<RawNewItem[]> {
    const params = new URLSearchParams({
      Recursive: 'true',
      SortBy: 'DateCreated',
      SortOrder: 'Descending',
      IncludeItemTypes: 'Movie,Series,Episode',
      MinDateCreated: since.toISOString(),
      Fields: 'Overview,ProductionYear,DateCreated,ProviderIds,SeriesName,SeriesId',
      Limit: '100',
    });
    const items = await this.items(`/Items?${params.toString()}`);
    return items.flatMap(mapNewItem);
  }

  async random(type: 'movie' | 'tv' | undefined, genre?: string): Promise<JellyfinItem | undefined> {
    const params = new URLSearchParams({
      Recursive: 'true',
      SortBy: 'Random',
      Limit: '1',
      IncludeItemTypes: type === 'tv' ? 'Series' : type === 'movie' ? 'Movie' : 'Movie,Series',
      Fields: 'Overview,ProductionYear,ProviderIds',
    });
    if (genre?.trim()) params.set('Genres', genre.trim());
    const items = await this.items(`/Items?${params.toString()}`);
    const item = items[0];
    return item ? mapPick(item) : undefined;
  }

  async sessions(): Promise<JellyfinSession[]> {
    const { status, body } = await requestJson(this.fetchImpl, `${this.baseUrl}/Sessions`, { headers: this.headers() });
    if (status !== 200 || !Array.isArray(body)) return [];
    return body.flatMap((item) => {
      const raw = asRecord(item);
      const playing = asRecord(raw?.NowPlayingItem);
      const user = asString(raw?.UserName);
      const title = asString(playing?.SeriesName) ?? asString(playing?.Name);
      if (!raw || !playing || !user || !title) return [];
      const play = asRecord(raw.PlayState);
      const runtime = asNumber(playing.RunTimeTicks);
      const position = asNumber(play?.PositionTicks);
      const progress = runtime && position !== undefined ? Math.round((position / runtime) * 100) : undefined;
      const transcode = asRecord(raw.TranscodingInfo);
      return [
        {
          user,
          title,
          quality: asString(playing.VideoRange) ?? asString(playing.Container) ?? 'Unknown',
          ...(progress === undefined ? {} : { progress }),
          mode: transcode ? 'Transcode' : 'Direct play',
        },
      ];
    });
  }

  async users(): Promise<JellyfinActivity[]> {
    const { status, body } = await requestJson(this.fetchImpl, `${this.baseUrl}/Users`, { headers: this.headers() });
    if (status !== 200 || !Array.isArray(body)) return [];
    return body.flatMap((item) => {
      const raw = asRecord(item);
      const name = asString(raw?.Name);
      if (!name) return [];
      const last = asString(raw?.LastActivityDate);
      const date = last ? new Date(last) : undefined;
      return [{ name, ...(date && !Number.isNaN(date.getTime()) ? { last: date } : {}) }];
    });
  }

  private async items(path: string): Promise<Record<string, unknown>[]> {
    const { status, body } = await requestJson(this.fetchImpl, this.baseUrl + path, { headers: this.headers() });
    if (status !== 200) throw new Error('Jellyfin request failed');
    const items = asRecord(body)?.Items;
    if (!Array.isArray(items)) return [];
    return items.flatMap((item) => {
      const record = asRecord(item);
      return record ? [record] : [];
    });
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `MediaBrowser Client="media-bot", Device="media-bot", DeviceId="media-bot", Version="1.0", Token="${this.apiKey}"`,
      'X-Emby-Token': this.apiKey,
    };
  }
}

function mapNewItem(raw: Record<string, unknown>): RawNewItem[] {
  const type = asString(raw.Type);
  const title = asString(raw.Name);
  if (!title || (type !== 'Movie' && type !== 'Series' && type !== 'Episode')) return [];
  const kind = type === 'Movie' ? 'movie' : type === 'Series' ? 'series' : 'episode';
  const seriesTitle = asString(raw.SeriesName);
  const seriesId = asString(raw.SeriesId);
  const tmdbId = positiveId(asRecord(raw.ProviderIds)?.Tmdb);
  const year = yearOf(raw.ProductionYear);
  const overview = asString(raw.Overview);
  const createdAt = asString(raw.DateCreated);
  return [
    {
      kind,
      title,
      ...(seriesTitle ? { seriesTitle } : {}),
      ...(seriesId ? { seriesKey: seriesId } : {}),
      ...(year ? { year } : {}),
      ...(overview ? { overview } : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(tmdbId ? { tmdbId } : {}),
    },
  ];
}

function mapPick(raw: Record<string, unknown>): JellyfinItem | undefined {
  const id = asString(raw.Id);
  const title = asString(raw.Name);
  if (!id || !title) return undefined;
  const tmdbId = positiveId(asRecord(raw.ProviderIds)?.Tmdb);
  const year = yearOf(raw.ProductionYear);
  const overview = asString(raw.Overview);
  return {
    id,
    title,
    kind: raw.Type === 'Series' ? 'show' : 'movie',
    ...(year ? { year } : {}),
    ...(overview ? { overview } : {}),
    ...(tmdbId ? { tmdbId } : {}),
  };
}

function yearOf(value: unknown): number | undefined {
  const year = asNumber(value);
  if (year === undefined || !Number.isInteger(year) || year < 1000 || year > 2999) return undefined;
  return year;
}

export function jellyfinConfigured(env: { JELLYFIN_URL?: string; JELLYFIN_API_KEY?: string }): env is {
  JELLYFIN_URL: string;
  JELLYFIN_API_KEY: string;
} {
  return Boolean(env.JELLYFIN_URL && env.JELLYFIN_API_KEY);
}
