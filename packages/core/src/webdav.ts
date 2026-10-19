import { basicAuthHeader } from './base64';
import { AuthError, ConfigError, ConflictError, NetworkError, SyncError } from './errors';
import type { DownloadResult, SyncProvider } from './providers';

/** Response header names are lower-case. */
export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Platform transport (Electron net.fetch, CapacitorHttp, Node fetch in tests). It must NOT follow
 * redirects, so credentials never leave the configured server, and may throw on connection
 * failures: the provider turns any thrown error into a NetworkError.
 */
export interface HttpTransport {
  request(request: HttpRequest): Promise<HttpResponse>;
}

export interface WebDavConfig {
  serverUrl: string;
  /** Absolute path of the sync file on the server, e.g. `/Apps/MovieWatchlist/movies.json`. */
  filePath: string;
  login: string;
  password: string;
}

export interface WebDavOptions {
  transport: HttpTransport;
  config: WebDavConfig;
  /** Permits plain http for loopback hosts only (tests and local development). */
  allowInsecureLoopback?: boolean;
}

export const MAX_PATH_LENGTH = 1024;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface WebDavTarget {
  /** Server origin plus optional path prefix, without a trailing slash. */
  baseUrl: string;
  /** Path segments below the base, the last one being the file name. */
  segments: string[];
}

/** Validates the server URL (https only) and the file path. Throws ConfigError. */
export function parseWebDavTarget(
  serverUrl: string,
  filePath: string,
  options: { allowInsecureLoopback?: boolean } = {},
): WebDavTarget {
  let url: URL;
  try {
    url = new URL(serverUrl.trim());
  } catch (cause) {
    throw new ConfigError('Server URL is not a valid URL', { cause });
  }
  const loopbackHttp =
    options.allowInsecureLoopback === true &&
    url.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !loopbackHttp) {
    throw new ConfigError('Server URL must use https');
  }
  if (url.username || url.password)
    throw new ConfigError('Server URL must not contain credentials');
  if (url.search || url.hash)
    throw new ConfigError('Server URL must not contain a query or fragment');

  if (filePath.length > MAX_PATH_LENGTH || !filePath.startsWith('/') || filePath.endsWith('/')) {
    throw new ConfigError('File path must be an absolute path to a file');
  }
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f?#]/.test(filePath)) {
    throw new ConfigError('File path contains forbidden characters');
  }
  const segments = filePath.slice(1).split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new ConfigError('File path must not contain empty, "." or ".." segments');
  }

  return { baseUrl: url.origin + url.pathname.replace(/\/+$/, ''), segments };
}

function pathUrl(target: WebDavTarget, depth: number, trailingSlash: boolean): string {
  const path = target.segments.slice(0, depth).map(encodeURIComponent).join('/');
  return `${target.baseUrl}/${path}${trailingSlash ? '/' : ''}`;
}

export class WebDavSyncProvider implements SyncProvider {
  private readonly transport: HttpTransport;
  private readonly target: WebDavTarget;
  private readonly authorization: string;

  constructor(options: WebDavOptions) {
    this.transport = options.transport;
    this.target = parseWebDavTarget(options.config.serverUrl, options.config.filePath, {
      allowInsecureLoopback: options.allowInsecureLoopback === true,
    });
    if (!options.config.login) throw new ConfigError('Login is required');
    if (!options.config.password) throw new ConfigError('Password is required');
    this.authorization = basicAuthHeader(options.config.login, options.config.password);
  }

  async download(): Promise<DownloadResult> {
    const response = await this.send('GET', this.fileUrl(), { Accept: 'application/json' });
    if (response.status === 404) return { kind: 'not-found' };
    if (response.status !== 200) throw this.errorFor(response.status);
    const etag = response.headers['etag'];
    if (!etag)
      throw new ConfigError('The server does not return ETags, so safe sync is impossible');
    return { kind: 'found', data: response.body, etag };
  }

  async upload(data: string, etag: string | null): Promise<{ etag: string | null }> {
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      ...(etag === null ? { 'If-None-Match': '*' } : { 'If-Match': etag }),
    };
    let response = await this.send('PUT', this.fileUrl(), headers, data);
    if (response.status === 409) {
      // A missing parent folder: create the path segment by segment, then retry once.
      await this.ensureParentFolders();
      response = await this.send('PUT', this.fileUrl(), headers, data);
    }
    if (response.status >= 200 && response.status < 300) {
      return { etag: response.headers['etag'] ?? null };
    }
    // If-Match against a file that vanished: let the engine download again.
    if (response.status === 404 && etag !== null) {
      throw new ConflictError('The remote file disappeared');
    }
    throw this.errorFor(response.status);
  }

  private fileUrl(): string {
    return pathUrl(this.target, this.target.segments.length, false);
  }

  private async ensureParentFolders(): Promise<void> {
    for (let depth = 1; depth < this.target.segments.length; depth++) {
      const response = await this.send('MKCOL', pathUrl(this.target, depth, true));
      // 201 created; 405 already exists. Some servers answer 200/204/301 for an existing folder.
      if (response.status >= 200 && response.status < 300) continue;
      if (response.status === 405) continue;
      throw this.errorFor(response.status);
    }
  }

  private async send(
    method: string,
    url: string,
    headers: Record<string, string> = {},
    body?: string,
  ): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    try {
      return await this.transport.request({
        method,
        url,
        headers: { Authorization: this.authorization, ...headers },
        ...(body === undefined ? {} : { body }),
      });
    } catch (error) {
      if (error instanceof SyncError) throw error;
      throw new NetworkError('Request failed', { cause: error });
    }
  }

  /** 401/402/403: credentials or plan; 412: precondition; everything else is treated as transient. */
  private errorFor(status: number): SyncError {
    if (status === 401 || status === 402 || status === 403) {
      return new AuthError(`Server denied access (HTTP ${status})`);
    }
    if (status === 412) return new ConflictError('Precondition failed (HTTP 412)');
    if (status === 429) return new NetworkError('Rate limited by the server (HTTP 429)');
    return new NetworkError(`Unexpected server response (HTTP ${status})`);
  }
}
