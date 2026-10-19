import type { HttpRequest, HttpResponse, HttpTransport } from '../webdav';

interface Override {
  match: (request: HttpRequest) => boolean;
  response: HttpResponse | Error;
  remaining: number;
}

const response = (
  status: number,
  headers: Record<string, string> = {},
  body = '',
): HttpResponse => ({ status, headers, body });

/**
 * In-memory WebDAV-like server following the behaviour measured in the Yandex/WsgiDAV spike:
 * PUT into a missing folder -> 409, MKCOL on an existing path -> 405, If-None-Match: * on an
 * existing file -> 412, If-Match with a stale etag -> 412, opaque quoted ETags.
 */
export class FakeWebDavServer implements HttpTransport {
  requests: HttpRequest[] = [];
  /** Expected `Authorization` header; other values get 401. */
  expectedAuthorization: string | undefined;
  /** Runs before each request is handled (simulates another client writing in between). */
  beforeRequest: ((request: HttpRequest) => void) | undefined;
  /** Quirk: the server never sends ETag headers. */
  omitEtags = false;
  /** Quirk: status used for If-Match against a missing file (RFC says 412, some servers say 404). */
  ifMatchMissingStatus = 412;
  private readonly files = new Map<string, { body: string; etag: string }>();
  private readonly folders = new Set<string>(['']);
  private readonly overrides: Override[] = [];
  private version = 0;

  /** The next `times` requests matching `match` get `result` (a response, or an Error to throw). */
  respondWith(
    match: (request: HttpRequest) => boolean,
    result: HttpResponse | Error,
    times = 1,
  ): void {
    this.overrides.push({ match, response: result, remaining: times });
  }

  /** Creates folders (and parents) directly. */
  mkdirp(path: string): void {
    let current = '';
    for (const segment of path.split('/').filter(Boolean)) {
      current += `/${segment}`;
      this.folders.add(current);
    }
  }

  /** Writes a file as another client would; returns its new etag. */
  writeFile(path: string, body: string): string {
    this.mkdirp(path.slice(0, path.lastIndexOf('/')));
    const etag = `"e${++this.version}"`;
    this.files.set(path, { body, etag });
    return etag;
  }

  readFile(path: string): { body: string; etag: string } | undefined {
    return this.files.get(path);
  }

  hasFolder(path: string): boolean {
    return this.folders.has(path);
  }

  requestsOf(method: string): HttpRequest[] {
    return this.requests.filter((request) => request.method === method);
  }

  request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push({ ...request, headers: { ...request.headers } });
    this.beforeRequest?.(request);
    const override = this.overrides.find((o) => o.remaining > 0 && o.match(request));
    if (override) {
      override.remaining -= 1;
      return override.response instanceof Error
        ? Promise.reject(override.response)
        : Promise.resolve(override.response);
    }
    return Promise.resolve(this.handle(request));
  }

  private etagHeader(etag: string): Record<string, string> {
    return this.omitEtags ? {} : { etag };
  }

  private handle(request: HttpRequest): HttpResponse {
    if (
      this.expectedAuthorization !== undefined &&
      request.headers['Authorization'] !== this.expectedAuthorization
    ) {
      return response(401);
    }
    const path = decodeURIComponent(new URL(request.url).pathname).replace(/\/+$/, '');
    const parent = path.slice(0, path.lastIndexOf('/'));
    const file = this.files.get(path);

    switch (request.method) {
      case 'GET':
        return file ? response(200, this.etagHeader(file.etag), file.body) : response(404);
      case 'MKCOL':
        if (this.folders.has(path) || file) return response(405);
        if (!this.folders.has(parent)) return response(409);
        this.folders.add(path);
        return response(201);
      case 'PUT': {
        if (!this.folders.has(parent)) return response(409);
        const ifMatch = request.headers['If-Match'];
        const ifNoneMatch = request.headers['If-None-Match'];
        if (ifNoneMatch === '*' && file) return response(412);
        if (ifMatch !== undefined) {
          if (!file) return response(this.ifMatchMissingStatus);
          if (ifMatch !== file.etag) return response(412);
        }
        const etag = this.writeFile(path, request.body ?? '');
        return response(file ? 204 : 201, this.etagHeader(etag));
      }
      default:
        return response(501);
    }
  }
}
