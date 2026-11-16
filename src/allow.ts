/** shortcut: names containing `:` are dropped so they stay safe inside Discord custom ids. */
export function parseAllowlist(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const names: string[] = [];
  for (const part of raw.split(',')) {
    const name = part.trim();
    if (!name || name.includes(':') || name.length > 64 || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function isAllowed(allow: readonly string[], name: string): boolean {
  return allow.includes(name);
}
