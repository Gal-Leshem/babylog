import type { ApiRequest, ApiResponse } from '../shared/protocol';

/** The request could not be completed or the answer was not an API answer: safe to retry later. */
export class NetworkError extends Error {}

export interface Endpoint {
  url: string;
  key: string;
}

export type FetchLike = typeof fetch;

export async function callApi(ep: Endpoint, req: ApiRequest, fetchImpl: FetchLike = fetch, timeoutMs = 20_000): Promise<ApiResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // text/plain keeps this a "simple" request, which Apps Script answers without a CORS preflight.
    const res = await fetchImpl(ep.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...req, key: ep.key }),
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const text = await res.text();
    try {
      const parsed = JSON.parse(text) as ApiResponse;
      if (typeof parsed !== 'object' || parsed === null || typeof parsed.ok !== 'boolean') throw new Error('shape');
      return parsed;
    } catch {
      throw new NetworkError(`unexpected answer (HTTP ${res.status})`);
    }
  } catch (e) {
    if (e instanceof NetworkError) throw e;
    throw new NetworkError(e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}
