type FetchImpl = typeof fetch;

export async function requestJson(
  fetchImpl: FetchImpl,
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: unknown },
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { Accept: 'application/json', ...init?.headers };
  const requestInit: RequestInit = { method: init?.method ?? 'GET', headers };
  if (init?.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    requestInit.body = JSON.stringify(init.body);
  }

  let response: Response;
  try {
    response = await fetchImpl(url, requestInit);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'network error';
    throw new Error(`Request failed: ${reason}`);
  }

  const text = await response.text();
  if (!text) return { status: response.status, body: undefined };
  try {
    return { status: response.status, body: JSON.parse(text) as unknown };
  } catch {
    return { status: response.status, body: { message: text.slice(0, 300) } };
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

export function positiveId(value: unknown): number | undefined {
  const id = asNumber(value);
  if (id === undefined || !Number.isInteger(id) || id <= 0) return undefined;
  return id;
}

export function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
