import type { Env } from './env';
import { JellyfinClient, jellyfinConfigured } from './jellyfin';
import { groupNewItems, type GroupedNew } from './library';
import type { SeerrClient } from './seerr';

export type NewEntry = GroupedNew & { posterPath?: string };

const DETAIL_CAP = 8;

export async function collectNew(env: Env, seerr: SeerrClient, days: number): Promise<NewEntry[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  if (jellyfinConfigured(env)) {
    const items = await new JellyfinClient(env.JELLYFIN_URL, env.JELLYFIN_API_KEY).recent(since);
    return attachPosters(seerr, groupNewItems(items).slice(0, DETAIL_CAP));
  }

  const media = await seerr.listAvailableMedia(40);
  const recent = media.filter((item) => {
    if (!item.addedAt) return false;
    const time = new Date(item.addedAt).getTime();
    return !Number.isNaN(time) && time >= since.getTime();
  });
  return attachPosters(
    seerr,
    recent.slice(0, DETAIL_CAP).map((item) => ({
      kind: item.mediaType === 'movie' ? 'movie' : 'show',
      title: item.mediaType === 'movie' ? `Movie ${item.tmdbId}` : `Show ${item.tmdbId}`,
      tmdbId: item.tmdbId,
      createdAt: item.addedAt,
      episodeCount: 0,
    })),
  );
}

async function attachPosters(seerr: SeerrClient, groups: GroupedNew[]): Promise<NewEntry[]> {
  const out: NewEntry[] = [];
  for (const group of groups) {
    if (!group.tmdbId) {
      out.push(group);
      continue;
    }
    try {
      const details = group.kind === 'movie' ? await seerr.getMovie(group.tmdbId) : await seerr.getTv(group.tmdbId);
      out.push({
        ...group,
        title: details.title || group.title,
        year: group.year ?? details.year,
        posterPath: details.posterPath,
        overview: group.overview ?? undefined,
      });
    } catch {
      out.push(group);
    }
  }
  return out;
}
