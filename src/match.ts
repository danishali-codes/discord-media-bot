export type LinkService = 'jellyfin' | 'plex';

export type MatchableUser = {
  id: number;
  jellyfinUsername?: string | null;
  plexUsername?: string | null;
  displayName?: string | null;
};

export type MatchResult =
  | { status: 'found'; user: MatchableUser }
  | { status: 'none' }
  | { status: 'ambiguous' };

function normalized(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function same(value: string | null | undefined, query: string): boolean {
  const candidate = normalized(value);
  return candidate.length > 0 && candidate === query;
}

/** Match a typed username against Seerr's user list. Service username wins over display name. */
export function matchSeerrUser(
  users: readonly MatchableUser[],
  username: string,
  service: LinkService,
): MatchResult {
  const query = normalized(username);
  if (!query) return { status: 'none' };

  const serviceField = service === 'jellyfin' ? 'jellyfinUsername' : 'plexUsername';
  const byService = users.filter((user) => same(user[serviceField], query));
  if (byService.length === 1) return { status: 'found', user: byService[0] };
  if (byService.length > 1) return { status: 'ambiguous' };

  const byDisplay = users.filter((user) => same(user.displayName, query));
  if (byDisplay.length === 1) return { status: 'found', user: byDisplay[0] };
  if (byDisplay.length > 1) return { status: 'ambiguous' };
  return { status: 'none' };
}
