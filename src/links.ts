export type NamedLink = { name: string; url: string };

export function isHttpUrl(value: string | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** shortcut: splits on commas, so a url that contains a comma is cut. Use %2C in that url. */
export function parseExtraLinks(raw: string | undefined): NamedLink[] {
  if (!raw?.trim()) return [];
  const links: NamedLink[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    const pipe = trimmed.indexOf('|');
    if (pipe <= 0) continue;
    const name = trimmed.slice(0, pipe).trim();
    const url = trimmed.slice(pipe + 1).trim();
    if (!name || !isHttpUrl(url)) continue;
    links.push({ name, url });
  }
  return links;
}

export function collectLinks(input: {
  jellyfin?: string;
  plex?: string;
  seerr?: string;
  status?: string;
  extra?: string;
}): NamedLink[] {
  const fixed: Array<[string, string | undefined]> = [
    ['Jellyfin', input.jellyfin],
    ['Plex', input.plex],
    ['Seerr', input.seerr],
    ['Status', input.status],
  ];
  const links = fixed.flatMap(([name, url]) => (isHttpUrl(url) ? [{ name, url }] : []));
  return [...links, ...parseExtraLinks(input.extra)];
}
