import { describe, expect, it } from 'vitest';
import { basicAuthHeader } from './base64';
import { AuthError, ConfigError, ConflictError, NetworkError, SyncError } from './errors';
import { SyncEngine } from './syncEngine';
import { DAY_MS, NOW, isoAt, makeEntry } from './testing/factories';
import { FakeWebDavServer } from './testing/fakeWebDavServer';
import { MemoryLocalStore } from './testing/memoryLocalStore';
import { parseSyncFile, serializeSyncFile } from './syncFile';
import {
  MAX_PATH_LENGTH,
  WebDavSyncProvider,
  parseWebDavTarget,
  type WebDavConfig,
} from './webdav';

const CONFIG: WebDavConfig = {
  serverUrl: 'https://dav.example',
  filePath: '/Apps/MovieWatchlist/movies.json',
  login: 'user',
  password: 'p@ss:wörd',
};
const FILE = CONFIG.filePath;

function setup(config: Partial<WebDavConfig> = {}) {
  const server = new FakeWebDavServer();
  const full = { ...CONFIG, ...config };
  server.expectedAuthorization = basicAuthHeader(full.login, full.password);
  const provider = new WebDavSyncProvider({ transport: server, config: full });
  return { server, provider };
}

const thrown = (run: () => Promise<unknown>) =>
  run().then(
    () => undefined,
    (e: unknown) => e,
  );

describe('parseWebDavTarget', () => {
  it('accepts https, keeps a path prefix and drops trailing slashes', () => {
    expect(parseWebDavTarget('https://dav.example/', '/a/b.json')).toEqual({
      baseUrl: 'https://dav.example',
      segments: ['a', 'b.json'],
    });
    expect(parseWebDavTarget('  https://h.example/remote.php/webdav//  ', '/f.json').baseUrl).toBe(
      'https://h.example/remote.php/webdav',
    );
  });

  it.each([
    'http://dav.example',
    'ftp://dav.example',
    'dav.example',
    '',
    'https://user:pw@dav.example',
    'https://dav.example/?x=1',
    'https://dav.example/#frag',
  ])('rejects server URL %j', (url) => {
    expect(() => parseWebDavTarget(url, '/f.json')).toThrow(ConfigError);
  });

  it('allows plain http only for loopback and only when asked', () => {
    expect(() => parseWebDavTarget('http://127.0.0.1:8080', '/f.json')).toThrow(ConfigError);
    const options = { allowInsecureLoopback: true };
    expect(parseWebDavTarget('http://127.0.0.1:8080', '/f.json', options).baseUrl).toBe(
      'http://127.0.0.1:8080',
    );
    expect(parseWebDavTarget('http://localhost:9', '/f.json', options).baseUrl).toBe(
      'http://localhost:9',
    );
    for (const url of [
      'http://example.com',
      'http://localhost.evil.com',
      'http://127.0.0.1.evil.com',
    ]) {
      expect(() => parseWebDavTarget(url, '/f.json', options)).toThrow(ConfigError);
    }
  });

  it.each([
    '',
    'movies.json',
    '/',
    '/a/',
    '/a//b.json',
    '/a/../b.json',
    '/a/./b.json',
    '/../b.json',
    '/a\\b.json',
    '/a\u0000b.json',
    '/a\nb.json',
    '/a?x=1',
    '/a#x',
    `/${'x'.repeat(MAX_PATH_LENGTH)}`,
  ])('rejects file path %j', (path) => {
    expect(() => parseWebDavTarget('https://dav.example', path)).toThrow(ConfigError);
  });

  it('accepts spaces, dots in names and non-ASCII', () => {
    expect(
      parseWebDavTarget('https://dav.example', '/Мои фильмы/.hidden/movies v2.json').segments,
    ).toEqual(['Мои фильмы', '.hidden', 'movies v2.json']);
  });
});

describe('construction', () => {
  it('requires login and password', () => {
    const server = new FakeWebDavServer();
    expect(
      () => new WebDavSyncProvider({ transport: server, config: { ...CONFIG, login: '' } }),
    ).toThrow(ConfigError);
    expect(
      () => new WebDavSyncProvider({ transport: server, config: { ...CONFIG, password: '' } }),
    ).toThrow(ConfigError);
  });

  it('validates the target eagerly', () => {
    const server = new FakeWebDavServer();
    expect(
      () =>
        new WebDavSyncProvider({
          transport: server,
          config: { ...CONFIG, serverUrl: 'http://dav.example' },
        }),
    ).toThrow(ConfigError);
  });
});

describe('download', () => {
  it('returns not-found for 404', async () => {
    const { provider } = setup();
    expect(await provider.download()).toEqual({ kind: 'not-found' });
  });

  it('returns body and the opaque etag exactly as sent', async () => {
    const { provider, server } = setup();
    const etag = server.writeFile(FILE, 'тело');
    expect(await provider.download()).toEqual({ kind: 'found', data: 'тело', etag });
    expect(etag.startsWith('"')).toBe(true);
  });

  it('sends Basic auth (UTF-8) and percent-encodes path segments', async () => {
    const { provider, server } = setup({ filePath: '/Мои фильмы/movies v2.json' });
    await provider.download();
    const [request] = server.requests;
    expect(request?.headers['Authorization']).toBe(basicAuthHeader('user', 'p@ss:wörd'));
    expect(request?.url).toBe(
      'https://dav.example/%D0%9C%D0%BE%D0%B8%20%D1%84%D0%B8%D0%BB%D1%8C%D0%BC%D1%8B/movies%20v2.json',
    );
  });

  it('refuses servers that do not return ETags (unsafe to write)', async () => {
    const { provider, server } = setup();
    server.writeFile(FILE, '{}');
    server.omitEtags = true;
    expect(await thrown(() => provider.download())).toBeInstanceOf(ConfigError);
  });

  it.each([
    [401, AuthError],
    [402, AuthError],
    [403, AuthError],
    [429, NetworkError],
    [500, NetworkError],
    [503, NetworkError],
    [301, NetworkError],
  ])('maps HTTP %i to the right typed error', async (status, errorClass) => {
    const { provider, server } = setup();
    server.respondWith((r) => r.method === 'GET', { status, headers: {}, body: '' });
    expect(await thrown(() => provider.download())).toBeInstanceOf(errorClass);
  });

  it('wraps transport failures into NetworkError with the cause', async () => {
    const { provider, server } = setup();
    const cause = new TypeError('fetch failed');
    server.respondWith(() => true, cause);
    const error = await thrown(() => provider.download());
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).cause).toBe(cause);
  });

  it('keeps typed errors thrown by the transport as they are', async () => {
    const { provider, server } = setup();
    server.respondWith(() => true, new AuthError('transport says no'));
    expect(await thrown(() => provider.download())).toBeInstanceOf(AuthError);
  });
});

describe('upload', () => {
  it('first upload: PUT 409, MKCOL per missing segment, retried PUT with create-only header', async () => {
    const { provider, server } = setup();
    const result = await provider.upload('{"v":1}', null);
    expect(server.requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      'PUT /Apps/MovieWatchlist/movies.json',
      'MKCOL /Apps/',
      'MKCOL /Apps/MovieWatchlist/',
      'PUT /Apps/MovieWatchlist/movies.json',
    ]);
    for (const put of server.requestsOf('PUT')) {
      expect(put.headers['If-None-Match']).toBe('*');
      expect(put.headers['If-Match']).toBeUndefined();
    }
    expect(server.readFile(FILE)?.body).toBe('{"v":1}');
    expect(result.etag).toBe(server.readFile(FILE)?.etag);
  });

  it('does not create folders when they exist (single PUT)', async () => {
    const { provider, server } = setup();
    server.mkdirp('/Apps/MovieWatchlist');
    await provider.upload('x', null);
    expect(server.requests.map((r) => r.method)).toEqual(['PUT']);
  });

  it('treats MKCOL 405 (already exists) as success', async () => {
    const { provider, server } = setup();
    server.mkdirp('/Apps/MovieWatchlist');
    server.respondWith((r) => r.method === 'PUT', { status: 409, headers: {}, body: '' });
    await provider.upload('x', null);
    expect(server.requestsOf('MKCOL').map((r) => new URL(r.url).pathname)).toEqual([
      '/Apps/',
      '/Apps/MovieWatchlist/',
    ]);
    expect(server.readFile(FILE)?.body).toBe('x');
  });

  it('creates only the missing part of a deeper path', async () => {
    const { provider, server } = setup({ filePath: '/a/b/c/d.json' });
    server.mkdirp('/a/b');
    await provider.upload('x', null);
    expect(server.hasFolder('/a/b/c')).toBe(true);
    expect(server.readFile('/a/b/c/d.json')).toBeDefined();
  });

  it('works for a file directly under the root (no folders to create)', async () => {
    const { provider, server } = setup({ filePath: '/movies.json' });
    await provider.upload('x', null);
    expect(server.requests.map((r) => r.method)).toEqual(['PUT']);
  });

  it('updates with If-Match and returns the new etag', async () => {
    const { provider, server } = setup();
    const etag = server.writeFile(FILE, 'old');
    const result = await provider.upload('new', etag);
    expect(server.requestsOf('PUT')[0]?.headers['If-Match']).toBe(etag);
    expect(server.readFile(FILE)?.body).toBe('new');
    expect(result.etag).toBe(server.readFile(FILE)?.etag);
    expect(result.etag).not.toBe(etag);
  });

  it('a stale etag raises ConflictError and leaves the file untouched', async () => {
    const { provider, server } = setup();
    const stale = server.writeFile(FILE, 'v1');
    server.writeFile(FILE, 'v2');
    expect(await thrown(() => provider.upload('mine', stale))).toBeInstanceOf(ConflictError);
    expect(server.readFile(FILE)?.body).toBe('v2');
  });

  it('create-only against an existing file raises ConflictError', async () => {
    const { provider, server } = setup();
    server.writeFile(FILE, 'theirs');
    expect(await thrown(() => provider.upload('mine', null))).toBeInstanceOf(ConflictError);
    expect(server.readFile(FILE)?.body).toBe('theirs');
  });

  it.each([404, 412])(
    'If-Match against a vanished file (server says %i) is a conflict',
    async (status) => {
      const { provider, server } = setup();
      server.mkdirp('/Apps/MovieWatchlist');
      server.ifMatchMissingStatus = status;
      expect(await thrown(() => provider.upload('x', '"gone"'))).toBeInstanceOf(ConflictError);
    },
  );

  it('returns a null etag when the server omits it', async () => {
    const { provider, server } = setup();
    server.omitEtags = true;
    expect(await provider.upload('x', null)).toEqual({ etag: null });
  });

  it.each([
    [401, AuthError],
    [402, AuthError],
    [403, AuthError],
    [423, NetworkError],
    [429, NetworkError],
    [500, NetworkError],
    [507, NetworkError],
  ])('maps a PUT answered with %i', async (status, errorClass) => {
    const { provider, server } = setup();
    server.mkdirp('/Apps/MovieWatchlist');
    server.respondWith((r) => r.method === 'PUT', { status, headers: {}, body: '' });
    expect(await thrown(() => provider.upload('x', null))).toBeInstanceOf(errorClass);
  });

  it('maps MKCOL failures (Yandex answered 402 and 500 here) without a second PUT', async () => {
    for (const [status, errorClass] of [
      [402, AuthError],
      [401, AuthError],
      [500, NetworkError],
    ] as const) {
      const { provider, server } = setup();
      server.respondWith((r) => r.method === 'MKCOL', { status, headers: {}, body: '' });
      expect(await thrown(() => provider.upload('x', null))).toBeInstanceOf(errorClass);
      expect(server.requestsOf('PUT')).toHaveLength(1);
    }
  });

  it('gives up with NetworkError when 409 persists after creating folders', async () => {
    const { provider, server } = setup();
    server.respondWith((r) => r.method === 'PUT', { status: 409, headers: {}, body: '' }, 2);
    const error = await thrown(() => provider.upload('x', null));
    expect(error).toBeInstanceOf(NetworkError);
    expect(server.requestsOf('PUT')).toHaveLength(2);
  });

  it('keeps UTF-8 bodies intact', async () => {
    const { provider, server } = setup();
    const body = JSON.stringify({ note: 'Дюна 🎬 — «круто»' });
    await provider.upload(body, null);
    expect(server.readFile(FILE)?.body).toBe(body);
    expect(await provider.download()).toMatchObject({ kind: 'found', data: body });
  });
});

describe('secrets', () => {
  it('never puts the password or Authorization header into error messages', async () => {
    const password = 'sup3r-s3cret-ünïcode';
    const { provider, server } = setup({ password });
    const statuses = [401, 402, 403, 409, 412, 429, 500];
    for (const status of statuses) {
      server.respondWith(() => true, { status, headers: {}, body: '' }, 4);
      for (const call of [
        () => provider.download(),
        () => provider.upload('x', null),
        () => provider.upload('x', '"e"'),
      ]) {
        const error = await thrown(call);
        if (error instanceof SyncError) {
          expect(error.message).not.toContain(password);
          expect(error.message.toLowerCase()).not.toContain('basic ');
        }
      }
    }
    server.respondWith(() => true, new TypeError(`connect failed for ${password}`));
    const networkError = (await thrown(() => provider.download())) as NetworkError;
    expect(networkError.message).not.toContain(password);
  });
});

describe('SyncEngine over WebDavSyncProvider (two devices, one server)', () => {
  function device(
    server: FakeWebDavServer,
    initial = [] as ReturnType<typeof makeEntry>[],
    now = NOW,
  ) {
    const store = new MemoryLocalStore(initial);
    const provider = new WebDavSyncProvider({
      transport: server,
      config: { ...CONFIG },
    });
    const engine = new SyncEngine({ provider, store, now: () => now });
    return { store, engine };
  }
  const ids = (entries: { id: string }[]) => entries.map((e) => e.id).sort();

  it('propagates a new entry from device A to device B, creating the folders on first sync', async () => {
    const server = new FakeWebDavServer();
    const a = device(server, [makeEntry({ tmdbId: 1 })]);
    const b = device(server);
    await a.engine.sync();
    expect(server.hasFolder('/Apps/MovieWatchlist')).toBe(true);
    await b.engine.sync();
    expect(ids(await b.store.getAll())).toEqual(['movie:1']);
  });

  it('merges edits made independently on both devices', async () => {
    const server = new FakeWebDavServer();
    const a = device(server, [makeEntry({ tmdbId: 1 })]);
    const b = device(server);
    await a.engine.sync();
    await b.engine.sync();
    a.store.put(makeEntry({ tmdbId: 2 }));
    b.store.put(makeEntry({ tmdbId: 3 }));
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();
    expect(ids(await a.store.getAll())).toEqual(['movie:1', 'movie:2', 'movie:3']);
    expect(await a.store.getAll()).toEqual(await b.store.getAll());
  });

  it('resolves a same-record conflict by LWW, using the 412 retry path', async () => {
    const server = new FakeWebDavServer();
    const a = device(server, [makeEntry({ status: 'want' })]);
    const b = device(server);
    await a.engine.sync();
    await b.engine.sync();
    a.store.put(makeEntry({ status: 'watching', updatedAt: isoAt(-2000) }));
    b.store.put(makeEntry({ status: 'watched', rating: 9, updatedAt: isoAt(-1000) }));
    await a.engine.sync();

    // B's engine downloads before A's write lands in its view: force the 412 by racing a write.
    const putsBefore = server.requestsOf('PUT').length;
    await b.engine.sync();
    expect(server.requestsOf('PUT').length).toBeGreaterThan(putsBefore);
    await a.engine.sync();
    for (const store of [a.store, b.store]) {
      expect(store.get('movie:603')).toMatchObject({ status: 'watched', rating: 9 });
    }
    expect(parseSyncFile(server.readFile(FILE)!.body).entries[0]).toMatchObject({
      status: 'watched',
    });
  });

  it('retries after a real 412 and converges', async () => {
    const server = new FakeWebDavServer();
    const a = device(server, [makeEntry({ tmdbId: 1 })]);
    await a.engine.sync();
    const b = device(server, [makeEntry({ tmdbId: 2 })]);
    // Another client writes between B's download and upload.
    let raced = false;
    server.beforeRequest = (request) => {
      if (request.method !== 'PUT' || raced) return;
      raced = true;
      server.writeFile(
        FILE,
        serializeSyncFile([makeEntry({ tmdbId: 1 }), makeEntry({ tmdbId: 9 })]),
      );
    };
    const outcome = await b.engine.sync();
    expect(outcome).toEqual({ uploaded: true, attempts: 2 });
    expect(ids(parseSyncFile(server.readFile(FILE)!.body).entries)).toEqual([
      'movie:1',
      'movie:2',
      'movie:9',
    ]);
  });

  it('syncs a deletion (tombstone) and its revival', async () => {
    const server = new FakeWebDavServer();
    const live = makeEntry({ updatedAt: isoAt(-3 * DAY_MS) });
    const a = device(server, [live]);
    const b = device(server);
    await a.engine.sync();
    await b.engine.sync();
    b.store.put({ ...live, deleted: true, updatedAt: isoAt(-2 * DAY_MS) });
    await b.engine.sync();
    await a.engine.sync();
    expect(a.store.get('movie:603')?.deleted).toBe(true);
    a.store.put({ ...live, deleted: false, status: 'want', updatedAt: isoAt(-DAY_MS) });
    await a.engine.sync();
    await b.engine.sync();
    expect(b.store.get('movie:603')).toMatchObject({ deleted: false });
  });

  it('surfaces an unsafe server (no ETags) instead of overwriting blindly', async () => {
    const server = new FakeWebDavServer();
    server.writeFile(FILE, serializeSyncFile([makeEntry()]));
    server.omitEtags = true;
    const a = device(server, [makeEntry({ tmdbId: 2 })]);
    await expect(a.engine.sync()).rejects.toBeInstanceOf(ConfigError);
    expect(server.requestsOf('PUT')).toHaveLength(0);
  });

  it('does not touch the remote file on auth failure and keeps local data', async () => {
    const server = new FakeWebDavServer();
    server.expectedAuthorization = 'Basic nope';
    const a = device(server, [makeEntry({ tmdbId: 1 })]);
    await expect(a.engine.sync()).rejects.toBeInstanceOf(AuthError);
    expect(server.readFile(FILE)).toBeUndefined();
    expect(ids(await a.store.getAll())).toEqual(['movie:1']);
  });
});
