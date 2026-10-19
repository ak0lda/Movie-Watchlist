import {
  NetworkError,
  type HttpRequest,
  type HttpResponse,
  type HttpTransport,
} from '@movie-watchlist/core';
import type { WebDavHttpPlugin } from './webDavHttp';

/** HttpTransport on top of the native WebDavHttp plugin. Failures surface as NetworkError. */
export function createCapacitorTransport(plugin: Pick<WebDavHttpPlugin, 'request'>): HttpTransport {
  return {
    async request(request: HttpRequest): Promise<HttpResponse> {
      try {
        const response = await plugin.request({
          method: request.method,
          url: request.url,
          headers: request.headers,
          ...(request.body === undefined ? {} : { body: request.body }),
        });
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(response.headers ?? {})) {
          headers[name.toLowerCase()] = value;
        }
        return { status: response.status, headers, body: response.body ?? '' };
      } catch (cause) {
        // The plugin's rejection text is deliberately not forwarded (it may contain URLs).
        throw new NetworkError('Request failed', { cause });
      }
    },
  };
}
