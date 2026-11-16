import { asNumber, asRecord, asString, requestJson } from './http';

export type DiskReading = { name: string; percent?: number; extra: Array<{ name: string; percent: number }> };

type FetchImpl = typeof fetch;

export class BeszelClient {
  constructor(
    private readonly baseUrl: string,
    private readonly email: string,
    private readonly password: string,
    private readonly fetchImpl: FetchImpl = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async disks(): Promise<DiskReading[]> {
    const token = await this.login();
    const { status, body } = await requestJson(this.fetchImpl, `${this.baseUrl}/api/collections/systems/records?perPage=50`, {
      headers: { Authorization: token },
    });
    if (status !== 200) throw new Error('Could not read Beszel systems');
    const items = asRecord(body)?.items;
    if (!Array.isArray(items)) return [];
    return items.flatMap((item) => {
      const raw = asRecord(item);
      const name = asString(raw?.name) ?? asString(raw?.host);
      if (!name) return [];
      return [readDisk(name, raw?.info)];
    });
  }

  private async login(): Promise<string> {
    const { status, body } = await requestJson(this.fetchImpl, `${this.baseUrl}/api/collections/users/auth-with-password`, {
      method: 'POST',
      body: { identity: this.email, password: this.password },
    });
    const token = asString(asRecord(body)?.token);
    if (status !== 200 || !token) throw new Error('Beszel login failed');
    return token;
  }
}

/**
 * Beszel stores the root disk percent on `info.dp`.
 * Older or hand-edited records may use disk, diskPct, or DiskPct.
 * Extra filesystems are `info.efs` as a name → percent map.
 */
export function readDisk(name: string, info: unknown): DiskReading {
  const parsed = typeof info === 'string' ? parseInfo(info) : asRecord(info);
  const percent = asNumber(parsed?.dp) ?? asNumber(parsed?.disk) ?? asNumber(parsed?.diskPct) ?? asNumber(parsed?.DiskPct);
  const extraRaw = asRecord(parsed?.efs);
  const extra = extraRaw
    ? Object.entries(extraRaw).flatMap(([fs, value]) => {
        const pct = asNumber(value);
        return pct === undefined ? [] : [{ name: fs, percent: pct }];
      })
    : [];
  return { name, ...(percent === undefined ? {} : { percent }), extra };
}

function parseInfo(value: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return undefined;
  }
}

export function beszelConfigured(env: { BESZEL_URL?: string; BESZEL_EMAIL?: string; BESZEL_PASSWORD?: string }): boolean {
  return Boolean(env.BESZEL_URL && env.BESZEL_EMAIL && env.BESZEL_PASSWORD);
}

export function diskLine(reading: DiskReading): string {
  if (reading.percent === undefined) return `❔ ${reading.name} — disk unknown`;
  const emoji = reading.percent >= 80 ? '⚠️' : '✅';
  const extra = reading.extra.map((fs) => `${fs.name} ${Math.round(fs.percent)}%`).join(', ');
  return `${emoji} ${reading.name} — disk ${Math.round(reading.percent)}%${extra ? ` (${extra})` : ''}`;
}
