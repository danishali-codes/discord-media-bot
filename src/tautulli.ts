import { asNumber, asRecord, asString, requestJson } from './http';

export type WatchStats = { days: number; plays: number; seconds: number };
export type HistoryItem = { title: string; at?: string };
export type NowPlaying = { user: string; title: string; quality: string; progress?: number; mode: string };
export type TautulliUser = { id: number; names: string[]; last?: Date };

type FetchImpl = typeof fetch;

export class TautulliClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchImpl = fetch,
  ) {}

  async users(): Promise<TautulliUser[]> {
    const data = await this.command('get_users');
    if (!Array.isArray(data)) return [];
    return data.flatMap((item) => {
      const raw = asRecord(item);
      const id = asNumber(raw?.user_id);
      if (!raw || id === undefined) return [];
      const names = [asString(raw.username), asString(raw.friendly_name)].filter((name): name is string => Boolean(name));
      const last = unixDate(raw.last_played) ?? unixDate(raw.last_seen);
      return [{ id, names, ...(last ? { last } : {}) }];
    });
  }

  async watchStats(userId: number): Promise<WatchStats[]> {
    const data = await this.command('get_user_watch_time_stats', { user_id: String(userId) });
    if (!Array.isArray(data)) return [];
    return data.flatMap((item) => {
      const raw = asRecord(item);
      const days = asNumber(raw?.query_days);
      const plays = asNumber(raw?.total_plays);
      const seconds = asNumber(raw?.total_time);
      if (days === undefined || plays === undefined || seconds === undefined) return [];
      return [{ days, plays, seconds }];
    });
  }

  async history(userId: number, length = 5): Promise<HistoryItem[]> {
    const data = await this.command('get_history', { user_id: String(userId), length: String(length) });
    const rows = asRecord(data)?.data;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((item) => {
      const raw = asRecord(item);
      const title = asString(raw?.full_title) ?? asString(raw?.title);
      if (!title) return [];
      const at = asString(raw?.date) ?? asString(raw?.started);
      return [{ title, ...(at ? { at } : {}) }];
    });
  }

  async activity(): Promise<NowPlaying[]> {
    const data = await this.command('get_activity');
    const sessions = asRecord(data)?.sessions;
    if (!Array.isArray(sessions)) return [];
    return sessions.flatMap((item) => {
      const raw = asRecord(item);
      const user = asString(raw?.friendly_name) ?? asString(raw?.user);
      const title = asString(raw?.full_title) ?? asString(raw?.title);
      if (!user || !title) return [];
      const progress = asNumber(raw?.progress_percent);
      const decision = asString(raw?.transcode_decision) ?? asString(raw?.video_decision);
      return [
        {
          user,
          title,
          quality: asString(raw?.quality_profile) ?? asString(raw?.stream_video_full_resolution) ?? 'Unknown',
          ...(progress === undefined ? {} : { progress: Math.round(progress) }),
          mode: decision?.toLowerCase() === 'transcode' ? 'Transcode' : 'Direct play',
        },
      ];
    });
  }

  private async command(cmd: string, params: Record<string, string> = {}): Promise<unknown> {
    const root = this.baseUrl.replace(/\/+$/, '');
    const api = root.endsWith('/api/v2') ? root : `${root}/api/v2`;
    const query = new URLSearchParams({ apikey: this.apiKey, cmd, ...params });
    const { status, body } = await requestJson(this.fetchImpl, `${api}?${query}`);
    if (status !== 200) throw new Error('Tautulli request failed');
    const response = asRecord(asRecord(body)?.response);
    if (asString(response?.result) === 'error') throw new Error(asString(response?.message) ?? 'Tautulli request failed');
    return response?.data;
  }
}

export function tautulliConfigured(env: { TAUTULLI_URL?: string; TAUTULLI_API_KEY?: string }): boolean {
  return Boolean(env.TAUTULLI_URL && env.TAUTULLI_API_KEY);
}

export function matchTautulliUser(users: TautulliUser[], username: string): TautulliUser | undefined {
  const needle = username.trim().toLowerCase();
  return users.find((user) => user.names.some((name) => name.toLowerCase() === needle));
}

function unixDate(value: unknown): Date | undefined {
  const n = asNumber(value);
  if (n === undefined || n <= 0) return undefined;
  const date = new Date(n > 10_000_000_000 ? n : n * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
