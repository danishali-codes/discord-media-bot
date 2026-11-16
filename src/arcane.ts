import { requestJson } from './http';

type FetchImpl = typeof fetch;

export class ArcaneClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly environmentId: string,
    private readonly fetchImpl: FetchImpl = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /** Documented Arcane route: POST /api/environments/{id}/containers/{containerId}/restart */
  async restart(container: string): Promise<void> {
    const url = `${this.baseUrl}/api/environments/${encodeURIComponent(this.environmentId)}/containers/${encodeURIComponent(container)}/restart`;
    const { status, body } = await requestJson(this.fetchImpl, url, {
      method: 'POST',
      headers: { 'X-Api-Key': this.apiKey },
    });
    if (status < 200 || status >= 300) {
      const message = typeof body === 'object' && body && 'message' in body ? String((body as { message: unknown }).message) : '';
      throw new Error(message || `Arcane returned ${status}`);
    }
  }
}

export function arcaneConfigured(env: {
  ARCANE_URL?: string;
  ARCANE_API_KEY?: string;
  ARCANE_ENV_ID?: string;
}): boolean {
  return Boolean(env.ARCANE_URL && env.ARCANE_API_KEY && env.ARCANE_ENV_ID);
}
