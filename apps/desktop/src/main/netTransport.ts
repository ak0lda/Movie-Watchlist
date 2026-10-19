import {
  NetworkError,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
} from '@movie-watchlist/core';

export const REQUEST_TIMEOUT_MS = 30_000;
export const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    redirect: 'manual';
    signal: AbortSignal;
  },
) => Promise<{
  status: number;
  headers: {
    forEach(callback: (value: string, key: string) => void): void;
    get(name: string): string | null;
  };
  text(): Promise<string>;
}>;

/**
 * HttpTransport on top of a fetch implementation (Electron's `net.fetch` in production).
 * Redirects are not followed so credentials stay with the configured server; a 3xx comes back as
 * a plain response and the provider treats it as an unexpected answer.
 */
export function createFetchTransport(
  fetchImpl: FetchLike,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): HttpTransport {
  return {
    async request(request: HttpRequest): Promise<HttpResponse> {
      let response: Awaited<ReturnType<FetchLike>>;
      let body: string;
      try {
        response = await fetchImpl(request.url, {
          method: request.method,
          headers: request.headers,
          ...(request.body === undefined ? {} : { body: request.body }),
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        });
        const declared = Number(response.headers.get('content-length'));
        if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
          throw new NetworkError('Response is too large');
        }
        body = await response.text();
      } catch (cause) {
        if (cause instanceof NetworkError) throw cause;
        throw new NetworkError('Request failed', { cause });
      }
      if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) {
        throw new NetworkError('Response is too large');
      }
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      return { status: response.status, headers, body };
    },
  };
}
