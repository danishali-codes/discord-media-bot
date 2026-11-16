import { asNumber, asRecord, asString } from './http';

export type MonitorView = {
  name: string;
  state: 'up' | 'down' | 'pending' | 'maintenance' | 'unknown';
  /** Fraction from 0 to 1. */
  uptime24?: number;
};

export type KumaAlert =
  | { kind: 'down' | 'up'; name: string; message?: string }
  | { kind: 'ignore' };

export function parseStatusPage(page: unknown, heartbeats: unknown): MonitorView[] {
  const groups = asRecord(page)?.publicGroupList;
  const beats = asRecord(asRecord(heartbeats)?.heartbeatList) ?? {};
  const uptime = asRecord(asRecord(heartbeats)?.uptimeList) ?? {};
  if (!Array.isArray(groups)) return [];

  const views: MonitorView[] = [];
  for (const group of groups) {
    const monitors = asRecord(group)?.monitorList;
    if (!Array.isArray(monitors)) continue;
    for (const monitor of monitors) {
      const record = asRecord(monitor);
      const name = asString(record?.name);
      const id = record?.id;
      if (!name || (typeof id !== 'number' && typeof id !== 'string')) continue;
      const key = String(id);
      const list = beats[key];
      const latest = Array.isArray(list) ? list[list.length - 1] : undefined;
      const uptime24 = uptimeFraction(uptime[`${key}_24`]);
      views.push({
        name,
        state: beatState(asRecord(latest)?.status),
        ...(uptime24 === undefined ? {} : { uptime24 }),
      });
    }
  }
  return views;
}

export function formatMonitor(view: MonitorView): string {
  const emoji = { up: '✅', down: '🔴', pending: '⏳', maintenance: '🛠️', unknown: '❔' }[view.state];
  const label = { up: 'up', down: 'down', pending: 'pending', maintenance: 'maintenance', unknown: 'unknown' }[
    view.state
  ];
  const uptime = view.uptime24 === undefined ? '' : ` · ${(view.uptime24 * 100).toFixed(1)}% uptime (24h)`;
  return `${emoji} ${view.name} — ${label}${uptime}`;
}

export function parseKumaWebhook(body: unknown): KumaAlert | undefined {
  const raw = asRecord(body);
  if (!raw) return undefined;
  const heartbeat = asRecord(maybeJson(raw.heartbeat));
  const monitor = asRecord(maybeJson(raw.monitor));
  const status = asNumber(heartbeat?.status);
  const name = asString(monitor?.name);
  if (status === undefined || !name) return undefined;
  if (status !== 0 && status !== 1) return { kind: 'ignore' };
  const message = asString(raw.msg) ?? asString(heartbeat?.msg);
  return { kind: status === 0 ? 'down' : 'up', name, ...(message ? { message } : {}) };
}

function beatState(status: unknown): MonitorView['state'] {
  const code = asNumber(status);
  if (code === 1) return 'up';
  if (code === 0) return 'down';
  if (code === 2) return 'pending';
  if (code === 3) return 'maintenance';
  return 'unknown';
}

function uptimeFraction(value: unknown): number | undefined {
  const n = asNumber(value);
  if (n === undefined || n < 0 || n > 1) return undefined;
  return n;
}

function maybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}
