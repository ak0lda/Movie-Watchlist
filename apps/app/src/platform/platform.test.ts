import {
  NetworkError,
  basicAuthHeader,
  ok,
  type DesktopApi,
  type MovieEntry,
} from '@movie-watchlist/core';
import {
  FakeWebDavServer,
  MemoryLocalStore,
  isoAt,
  makeEntry,
} from '@movie-watchlist/core/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  FakeApp,
  FakeDocument,
  FakeSecureStorage,
  MemoryStorage,
  ServerBackedPlugin,
  tick,
} from '../testing/platformFakes';
import { startPlatformSync, type AndroidPlatform } from '.';
import { SYNC_CONFIG_STORAGE_KEY, SYNC_PASSWORD_KEY } from './native/storage';

const LOGIN = 'user@yandex.ru';
const PASSWORD = 'app-пароль-🔑';
const URL_A = 'https://dav.example';
const FILE = '/Apps/MovieWatchlist/movies.json';

function android(server: FakeWebDavServer) {
  const storage = new MemoryStorage();
  const secure = new FakeSecureStorage();
  const plugin = new ServerBackedPlugin(server);
  const app = new FakeApp();
  const platform: AndroidPlatform = { webDavHttp: plugin, secureStorage: secure, app, storage };
  return { storage, secure, plugin, app, platform };
}

function davServer() {
  const server = new FakeWebDavServer();
  server.expectedAuthorization = basicAuthHeader(LOGIN, PASSWORD);
  return server;
}

function start(server: FakeWebDavServer, entries: MovieEntry[] = []) {
  const device = android(server);
  const store = new MemoryLocalStore(entries);
  const sync = startPlatformSync(
    { desktop: undefined, android: device.platform, document: new FakeDocument() },
    store,
  )!;
  return { ...device, store, sync };
}

const configure = (sync: ReturnType<typeof start>['sync'], url = URL_A) =>
  sync.settings.saveConfig({ serverUrl: url, filePath: FILE, login: LOGIN, password: PASSWORD });

describe('platform selection', () => {
  it('returns nothing in a plain browser (the app works without sync)', () => {
    expect(
      startPlatformSync(
        { desktop: undefined, android: undefined, document: new FakeDocument() },
        new MemoryLocalStore(),
      ),
    ).toBeUndefined();
  });

  it('uses the IPC bridge in Electron and syncs at startup and on window-hidden events', async () => {
    const download = vi.fn(() => Promise.resolve(ok({ kind: 'not-found' as const })));
    let notify: () => void = () => undefined;
    const desktop = {
      sync: {
        getConfig: () =>
          Promise.resolve(ok({ serverUrl: '', filePath: '', login: '', hasPassword: false })),
        saveConfig: () => Promise.reject(new Error('unused')),
        clearPassword: () => Promise.reject(new Error('unused')),
        download,
        upload: () => Promise.reject(new Error('unused')),
      },
      onWindowHidden: (listener: () => void) => {
        notify = listener;
        return () => undefined;
      },
    } as unknown as DesktopApi;
    const sync = startPlatformSync(
      { desktop, android: undefined, document: new FakeDocument() },
      new MemoryLocalStore(),
    );
    expect(sync).toBeDefined();
    await tick();
    expect(download).toHaveBeenCalledTimes(1);
    notify();
    await tick();
    expect(download).toHaveBeenCalledTimes(2);
  });

  it('prefers Electron when both bridges exist', async () => {
    const server = davServer();
    const device = android(server);
    const download = vi.fn(() => Promise.resolve(ok({ kind: 'not-found' as const })));
    const desktop = {
      sync: { download, getConfig: () => Promise.resolve(ok({})) },
      onWindowHidden: () => () => undefined,
    } as unknown as DesktopApi;
    startPlatformSync(
      { desktop, android: device.platform, document: new FakeDocument() },
      new MemoryLocalStore(),
    );
    await tick();
    expect(download).toHaveBeenCalled();
    expect(device.plugin.calls).toHaveLength(0);
  });
});

describe('Android wiring', () => {
  it('stays quiet at startup while sync is not configured', async () => {
    const server = davServer();
    const { sync, plugin } = start(server);
    await tick();
    expect(sync.service.getStatus()).toEqual({ kind: 'idle' });
    expect(plugin.calls).toHaveLength(0);
  });

  it('saves the password only in secure storage, never in localStorage', async () => {
    const server = davServer();
    const { sync, storage, secure } = start(server);
    const view = await configure(sync);
    expect(view).toEqual({ serverUrl: URL_A, filePath: FILE, login: LOGIN, hasPassword: true });
    expect(secure.data.get(SYNC_PASSWORD_KEY)).toBe(PASSWORD);
    expect(JSON.stringify([...storage.data.entries()])).not.toContain(PASSWORD);
    expect(JSON.parse(storage.data.get(SYNC_CONFIG_STORAGE_KEY)!)).toEqual({
      serverUrl: URL_A,
      filePath: FILE,
      login: LOGIN,
    });
  });

  it('uses the right default server and path in the settings view', async () => {
    const { sync } = start(davServer());
    expect(await sync.settings.getConfig()).toEqual({
      serverUrl: 'https://webdav.yandex.ru',
      filePath: '/Apps/MovieWatchlist/movies.json',
      login: '',
      hasPassword: false,
    });
  });

  it('syncs when the app goes to the background, not when it comes back', async () => {
    const server = davServer();
    const { sync, app, plugin } = start(server, [makeEntry({ tmdbId: 1 })]);
    await configure(sync);
    await tick();
    const before = plugin.calls.length;
    app.setActive(true);
    await tick();
    expect(plugin.calls.length).toBe(before);
    app.setActive(false);
    await tick();
    await tick();
    expect(plugin.calls.length).toBeGreaterThan(before);
    expect(server.readFile(FILE)?.body).toContain('movie:1');
  });

  it('syncs at startup when already configured', async () => {
    const server = davServer();
    const first = start(server, [makeEntry({ tmdbId: 1 })]);
    await configure(first.sync);
    await first.sync.service.syncNow('manual');
    expect(server.readFile(FILE)?.body).toContain('movie:1');

    // A restart: same storages, fresh app instance.
    const store = new MemoryLocalStore();
    const sync = startPlatformSync(
      { desktop: undefined, android: first.platform, document: new FakeDocument() },
      store,
    )!;
    await tick();
    await tick();
    await tick();
    expect(sync.service.getStatus().kind).toBe('synced');
    expect((await store.getAll()).map((e) => e.id)).toEqual(['movie:1']);
  });
});

describe('Android end to end (two devices through the native plugin)', () => {
  async function pair() {
    const server = davServer();
    const a = start(server);
    const b = start(server);
    await configure(a.sync);
    await configure(b.sync);
    return { server, a, b };
  }
  const titles = async (store: MemoryLocalStore) =>
    (await store.getAll())
      .filter((e) => !e.deleted)
      .map((e) => e.id)
      .sort();

  it('creates the folders with MKCOL and converges', async () => {
    const { server, a, b } = await pair();
    a.store.put(makeEntry({ tmdbId: 1 }));
    b.store.put(makeEntry({ tmdbId: 2 }));
    await a.sync.service.syncNow('manual');
    expect(a.plugin.calls.map((c) => c.method)).toContain('MKCOL');
    expect(server.hasFolder('/Apps/MovieWatchlist')).toBe(true);
    await b.sync.service.syncNow('manual');
    await a.sync.service.syncNow('manual');
    expect(await titles(a.store)).toEqual(['movie:1', 'movie:2']);
    expect(await titles(b.store)).toEqual(['movie:1', 'movie:2']);
    expect(a.sync.service.getStatus().kind).toBe('synced');
  });

  it('last writer wins and deletions propagate', async () => {
    const { a, b } = await pair();
    const base = makeEntry({ tmdbId: 1, updatedAt: isoAt(-5000) });
    a.store.put(base);
    await a.sync.service.syncNow('manual');
    await b.sync.service.syncNow('manual');
    a.store.put({ ...base, status: 'watching', updatedAt: isoAt(-3000) });
    b.store.put({ ...base, status: 'watched', rating: 9, updatedAt: isoAt(-1000) });
    await a.sync.service.syncNow('manual');
    await b.sync.service.syncNow('manual');
    await a.sync.service.syncNow('manual');
    expect(a.store.get(base.id)).toMatchObject({ status: 'watched', rating: 9 });

    b.store.put({ ...base, deleted: true, status: 'watched', updatedAt: isoAt(-500) });
    await b.sync.service.syncNow('manual');
    await a.sync.service.syncNow('manual');
    expect(a.store.get(base.id)?.deleted).toBe(true);
  });

  it.each([
    [
      'plugin failure',
      (s: FakeWebDavServer, d: ReturnType<typeof start>) =>
        void (d.plugin.failWith = new Error('boom')),
      'errors.sync.network',
    ],
    [
      'wrong password',
      (s: FakeWebDavServer) => void (s.expectedAuthorization = 'Basic nope'),
      'errors.sync.auth',
    ],
    [
      'HTTP 402 on writes',
      (s: FakeWebDavServer) =>
        s.respondWith((r) => r.method !== 'GET', { status: 402, headers: {}, body: '' }, 9),
      'errors.sync.auth',
    ],
    [
      'newer file schema',
      (s: FakeWebDavServer) => void s.writeFile(FILE, '{"schemaVersion":99,"entries":[]}'),
      'errors.schema.newerVersion',
    ],
  ])('shows a translated error for %s and keeps local data', async (_name, break_, key) => {
    const { server, a } = await pair();
    a.store.put(makeEntry({ tmdbId: 1 }));
    break_(server, a);
    await a.sync.service.syncNow('manual');
    expect(a.sync.service.getStatus()).toEqual({ kind: 'error', key });
    expect(await titles(a.store)).toEqual(['movie:1']);
  });

  it('does not touch the network when sync is not configured (manual click shows the config error)', async () => {
    const server = davServer();
    const { sync, plugin } = start(server);
    await sync.service.syncNow('manual');
    expect(sync.service.getStatus()).toEqual({ kind: 'error', key: 'errors.sync.config' });
    expect(plugin.calls).toHaveLength(0);
  });

  it('asks for the password again when the server changes, even from the settings API', async () => {
    const { a } = await pair();
    await expect(
      a.sync.settings.saveConfig({
        serverUrl: 'https://evil.example',
        filePath: FILE,
        login: LOGIN,
      }),
    ).rejects.toMatchObject({ code: 'config' });
    expect((await a.sync.settings.getConfig()).serverUrl).toBe(URL_A);
  });

  it('turns a refused keystore into a ConfigError on save', async () => {
    const server = davServer();
    const { sync, secure } = start(server);
    secure.failSet = true;
    await expect(configure(sync)).rejects.toMatchObject({ code: 'config' });
    expect((await sync.settings.getConfig()).login).toBe('');
  });

  it('never sends the password to a different host than the configured one', async () => {
    const { server, a } = await pair();
    a.store.put(makeEntry({ tmdbId: 1 }));
    await a.sync.service.syncNow('manual');
    const hosts = new Set(a.plugin.calls.map((c) => new URL(c.url).host));
    expect(hosts).toEqual(new Set(['dav.example']));
    expect(
      server.requests.every((r) => r.headers['Authorization'] === basicAuthHeader(LOGIN, PASSWORD)),
    ).toBe(true);
  });

  it('survives a network error type from the plugin as NetworkError', async () => {
    const { a } = await pair();
    a.plugin.failWith = new NetworkError('x');
    await a.sync.service.syncNow('manual');
    expect(a.sync.service.getStatus()).toEqual({ kind: 'error', key: 'errors.sync.network' });
  });
});
