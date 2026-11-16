import type { UpcomingEpisode } from './library';
import { asNumber, asRecord, asString, positiveId, requestJson } from './http';

type FetchImpl = typeof fetch;

export class SonarrClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchImpl = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async calendar(start: string, end: string): Promise<UpcomingEpisode[]> {
    const params = new URLSearchParams({ start, end, includeSeries: 'true' });
    const { status, body } = await requestJson(this.fetchImpl, `${this.baseUrl}/api/v3/calendar?${params}`, {
      headers: { 'X-Api-Key': this.apiKey },
    });
    if (status !== 200) throw new Error('Sonarr calendar request failed');
    if (!Array.isArray(body)) return [];
    return body.flatMap(mapEpisode);
  }
}

function indexNumber(value: unknown): number | undefined {
  const n = asNumber(value);
  if (n === undefined || !Number.isInteger(n) || n < 0) return undefined;
  return n;
}

function mapEpisode(value: unknown): UpcomingEpisode[] {
  const raw = asRecord(value);
  const series = asRecord(raw?.series);
  const show = asString(series?.title);
  if (!raw || !show) return [];
  const tmdbId = positiveId(series?.tmdbId);
  const tvdbId = positiveId(series?.tvdbId);
  const title = asString(raw.title);
  const season = indexNumber(raw.seasonNumber);
  const episode = indexNumber(raw.episodeNumber);
  const airsAt = asString(raw.airDateUtc) ?? asString(raw.airDate);
  return [
    {
      show,
      ...(title ? { title } : {}),
      ...(season !== undefined ? { season } : {}),
      ...(episode !== undefined ? { episode } : {}),
      ...(airsAt ? { airsAt } : {}),
      ...(tmdbId ? { tmdbId } : {}),
      ...(tvdbId ? { tvdbId } : {}),
    },
  ];
}

export function sonarrConfigured(env: { SONARR_URL?: string; SONARR_API_KEY?: string }): boolean {
  return Boolean(env.SONARR_URL && env.SONARR_API_KEY);
}
