export type RawNewItem = {
  kind: 'movie' | 'series' | 'episode';
  title: string;
  seriesTitle?: string;
  seriesKey?: string;
  year?: number;
  overview?: string;
  createdAt?: string;
  tmdbId?: number;
};

export type GroupedNew = {
  kind: 'movie' | 'show';
  title: string;
  year?: number;
  overview?: string;
  createdAt?: string;
  tmdbId?: number;
  episodeCount: number;
};

export type UpcomingEpisode = {
  show: string;
  title?: string;
  season?: number;
  episode?: number;
  airsAt?: string;
  tmdbId?: number;
  tvdbId?: number;
};

export type ActivityHit = { matched: boolean; at?: Date };

export function groupNewItems(items: RawNewItem[]): GroupedNew[] {
  const shows = new Map<string, GroupedNew>();
  const movies: GroupedNew[] = [];

  for (const item of items) {
    if (item.kind === 'movie') {
      movies.push({
        kind: 'movie',
        title: item.title,
        year: item.year,
        overview: item.overview,
        createdAt: item.createdAt,
        tmdbId: item.tmdbId,
        episodeCount: 0,
      });
      continue;
    }

    const key = item.seriesKey || normalize(item.seriesTitle || item.title);
    if (!key) continue;
    const current = shows.get(key) ?? {
      kind: 'show' as const,
      title: item.seriesTitle || item.title,
      episodeCount: 0,
    };
    if (item.kind === 'episode') current.episodeCount += 1;
    if (item.seriesTitle) current.title = item.seriesTitle;
    else if (!current.title) current.title = item.title;
    current.year = current.year ?? item.year;
    current.overview = current.overview ?? item.overview;
    current.tmdbId = current.tmdbId ?? item.tmdbId;
    if (isNewer(item.createdAt, current.createdAt)) current.createdAt = item.createdAt;
    shows.set(key, current);
  }

  return [...movies, ...shows.values()].sort((left, right) => timeOf(right.createdAt) - timeOf(left.createdAt));
}

export function newItemDetail(group: GroupedNew): string {
  if (group.kind === 'movie') return 'Movie';
  if (group.episodeCount === 1) return '1 new episode';
  if (group.episodeCount > 1) return `${group.episodeCount} new episodes`;
  return 'Show';
}

export function filterUpcoming(
  episodes: UpcomingEpisode[],
  owned: { tmdbIds: number[]; tvdbIds: number[] },
): UpcomingEpisode[] {
  const tmdb = new Set(owned.tmdbIds);
  const tvdb = new Set(owned.tvdbIds);
  return episodes.filter(
    (episode) =>
      (episode.tmdbId !== undefined && tmdb.has(episode.tmdbId)) ||
      (episode.tvdbId !== undefined && tvdb.has(episode.tvdbId)),
  );
}

/** Plex and Jellyfin logins stored on the Seerr user, not the name typed into /link-account. */
export function mediaUsernames(user: { plexUsername?: string | null; jellyfinUsername?: string | null } | undefined): {
  plex?: string;
  jellyfin?: string;
} {
  const plex = user?.plexUsername?.trim();
  const jellyfin = user?.jellyfinUsername?.trim();
  return {
    ...(plex ? { plex } : {}),
    ...(jellyfin ? { jellyfin } : {}),
  };
}

export function classifyActivity(
  hits: ActivityHit[],
  now: Date,
  days: number,
): 'active' | 'inactive' | 'unknown' {
  const matched = hits.filter((hit) => hit.matched);
  if (matched.length === 0) return 'unknown';
  const times = matched.flatMap((hit) => {
    if (!hit.at || Number.isNaN(hit.at.getTime())) return [];
    return [hit.at.getTime()];
  });
  if (times.length === 0) return 'inactive';
  const age = now.getTime() - Math.max(...times);
  return age >= days * 24 * 60 * 60 * 1000 ? 'inactive' : 'active';
}

function normalize(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function timeOf(iso?: string): number {
  if (!iso) return 0;
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function isNewer(candidate?: string, current?: string): boolean {
  return timeOf(candidate) > timeOf(current);
}
