import {
  AuthError,
  ConfigError,
  ConflictError,
  NetworkError,
  basicAuthHeader,
  parseSyncFile,
  serializeSyncFile,
  SyncEngine,
  type DownloadResult,
  type SyncProvider,
} from '@movie-watchlist/core';
import {
  FakeWebDavServer,
  MemoryLocalStore,
  NOW,
  isoAt,
  makeEntry,
} from '@movie-watchlist/core/testing';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore, DEFAULT_FILE_PATH, DEFAULT_SERVER_URL } from '../src/main/configStore';
import { createFetchTransport, type FetchLike } from '../src/main/netTransport';
import { SecretStore } from '../src/main/secretStore';
import { MainSyncBackend } from '../src/main/syncBackend';
import { FakeCrypto, makeTempDir, serveRaw, serveWebDav, type RunningServer } from './helpers';

const FILE = '/Apps/MovieWatchlist/movies.json';
const LOGIN = 'user@yandex.ru';
const PASSWORD = 'app-пароль-🔑';

let dir: string;
let cleanup: () => Promise<void>;
const servers: RunningServer[] = [];

beforeEach(async () => {
  ({ dir, cleanup } = await makeTempDir());
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
  await cleanup();
});

async function setup(options: { crypto?: FakeCrypto; dav?: FakeWebDavServer } = {}) {
  const dav = options.dav ?? new FakeWebDavServer();
  dav.expectedAuthorization = basicAuthHeader(LOGIN, PASSWORD);
  const server = await serveWebDav(dav);
  servers.push(server);
  const crypto = options.crypto ?? new FakeCrypto();
  const paths = {
    config: path.join(dir, 'sync-config.json'),
    secret: path.join(dir, 'sync-secret.bin'),
  };
  const backend = new MainSyncBackend({
    configStore: new ConfigStore(paths.config),
    secretStore: new SecretStore(paths.secret, crypto),
    transport: createFetchTransport(fetch as unknown as FetchLike, 2000),
    allowInsecureLoopback: true,
  });
  const input = { serverUrl: server.url, filePath: FILE, login: LOGIN, password: PASSWORD };
  return { dav, server, backend, crypto, paths, input };
}

const thrown = (run: () => Promise<unknown>) =>
  run().then(
    () => undefined,
    (e: unknown) => e,
  );

describe('configuration', () => {
  it('reports the documented defaults before anything is saved', async () => {
    const { backend } = await setup();
    expect(await backend.getConfigView()).toEqual({
      serverUrl: DEFAULT_SERVER_URL,
      filePath: DEFAULT_FILE_PATH,
      login: '',
      hasPassword: false,
    });
    expect(DEFAULT_SERVER_URL).toBe('https://webdav.yandex.ru');
    expect(DEFAULT_FILE_PATH).toBe('/Apps/MovieWatchlist/movies.json');
  });

  it('saves settings, keeps the password encrypted and never returns it', async () => {
    const { backend, input, paths } = await setup();
    const view = await backend.saveConfig(input);
    expect(view).toEqual({
      serverUrl: input.serverUrl,
      filePath: FILE,
      login: LOGIN,
      hasPassword: true,
    });
    expect(JSON.stringify(view)).not.toContain(PASSWORD);

    const configText = await readFile(paths.config, 'utf8');
    expect(configText).not.toContain(PASSWORD);
    expect(configText).not.toContain('password');
    const secret = await readFile(paths.secret);
    expect(secret.includes(Buffer.from(PASSWORD))).toBe(false);
    expect((await readdir(dir)).sort()).toEqual(['sync-config.json', 'sync-secret.bin']);
  });

  it('keeps the stored password when only the file path changes', async () => {
    const { backend, input } = await setup();
    await backend.saveConfig(input);
    const { password, ...withoutPassword } = input;
    void password;
    const view = await backend.saveConfig({ ...withoutPassword, filePath: '/other/movies.json' });
    expect(view).toMatchObject({ filePath: '/other/movies.json', hasPassword: true });
  });

  it.each([
    [
      'server',
      (i: { serverUrl: string }) => ({ serverUrl: i.serverUrl.replace('127.0.0.1', 'localhost') }),
    ],
    ['login', () => ({ login: 'someone-else' })],
  ])('refuses to reuse the stored password after the %s changes', async (_name, change) => {
    const { backend, input, paths } = await setup();
    await backend.saveConfig(input);
    const { password, ...withoutPassword } = input;
    void password;
    const before = await readFile(paths.config, 'utf8');
    await expect(
      backend.saveConfig({ ...withoutPassword, ...change(input) }),
    ).rejects.toBeInstanceOf(ConfigError);
    expect(await readFile(paths.config, 'utf8')).toBe(before);
    expect((await backend.getConfigView()).login).toBe(LOGIN);
  });

  it('accepts a changed destination together with a new password', async () => {
    const { backend, input } = await setup();
    await backend.saveConfig(input);
    const view = await backend.saveConfig({ ...input, login: 'new-login', password: 'new-pass' });
    expect(view).toMatchObject({ login: 'new-login', hasPassword: true });
  });

  it('does not save settings when the password cannot be stored securely', async () => {
    const crypto = new FakeCrypto();
    crypto.available = false;
    const { backend, input, paths } = await setup({ crypto });
    await expect(backend.saveConfig(input)).rejects.toBeInstanceOf(ConfigError);
    expect(await readdir(dir)).toEqual([]);
    expect(paths.config).toBeDefined();
  });

  it('forgets the password on clearPassword()', async () => {
    const { backend, input } = await setup();
    await backend.saveConfig(input);
    expect((await backend.clearPassword()).hasPassword).toBe(false);
    expect(await thrown(() => backend.download())).toBeInstanceOf(ConfigError);
  });

  it('reports no password when the stored blob cannot be decrypted', async () => {
    const { backend, input, paths } = await setup();
    await backend.saveConfig(input);
    await writeFile(paths.secret, 'corrupted');
    expect((await backend.getConfigView()).hasPassword).toBe(false);
    expect(await thrown(() => backend.upload('{}', null))).toBeInstanceOf(ConfigError);
  });
});

describe('network operations over real HTTP', () => {
  it('refuses to sync before configuration', async () => {
    const { backend } = await setup();
    expect(await thrown(() => backend.download())).toBeInstanceOf(ConfigError);
    expect(await thrown(() => backend.upload('{}', null))).toBeInstanceOf(ConfigError);
  });

  it('first run: 404, create-only upload with folder creation, then download', async () => {
    const { backend, input, dav } = await setup();
    await backend.saveConfig(input);
    expect(await backend.download()).toEqual({ kind: 'not-found' });

    const { etag } = await backend.upload('{"first":true}', null);
    expect(dav.hasFolder('/Apps')).toBe(true);
    expect(dav.hasFolder('/Apps/MovieWatchlist')).toBe(true);
    expect(dav.readFile(FILE)?.body).toBe('{"first":true}');

    const downloaded = await backend.download();
    expect(downloaded).toEqual({
      kind: 'found',
      data: '{"first":true}',
      etag: dav.readFile(FILE)?.etag,
    });
    expect(etag).toBe(dav.readFile(FILE)?.etag);
  });

  it('sends the saved credentials as UTF-8 Basic auth and nothing else secret', async () => {
    const { backend, input, dav } = await setup();
    await backend.saveConfig(input);
    await backend.download();
    const request = dav.requests[0];
    expect(request?.headers['Authorization']).toBe(basicAuthHeader(LOGIN, PASSWORD));
  });

  it('updates with If-Match and detects stale etags (412 -> ConflictError)', async () => {
    const { backend, input, dav } = await setup();
    await backend.saveConfig(input);
    const first = await backend.upload('v1', null);
    const second = await backend.upload('v2', first.etag);
    expect(second.etag).not.toBe(first.etag);
    expect(await thrown(() => backend.upload('v3', first.etag))).toBeInstanceOf(ConflictError);
    expect(dav.readFile(FILE)?.body).toBe('v2');
  });

  it('maps a wrong password to AuthError', async () => {
    const { backend, input } = await setup();
    await backend.saveConfig({ ...input, password: 'wrong' });
    expect(await thrown(() => backend.download())).toBeInstanceOf(AuthError);
  });

  it('maps Yandex-style 402 on writes to AuthError and keeps reads working', async () => {
    const { backend, input, dav } = await setup();
    await backend.saveConfig(input);
    dav.respondWith((r) => r.method !== 'GET', { status: 402, headers: {}, body: '' }, 10);
    expect(await backend.download()).toEqual({ kind: 'not-found' });
    expect(await thrown(() => backend.upload('x', null))).toBeInstanceOf(AuthError);
  });

  it('maps an unreachable server to NetworkError', async () => {
    const { backend, input, server } = await setup();
    await backend.saveConfig(input);
    await server.close();
    servers.length = 0;
    expect(await thrown(() => backend.download())).toBeInstanceOf(NetworkError);
  });

  it('does not follow a redirect with the credentials', async () => {
    let stolen = 0;
    const thief = await serveRaw((_req, res) => {
      stolen += 1;
      res.end();
    });
    const redirector = await serveRaw((_req, res) => {
      res.writeHead(307, { Location: `${thief.url}/x` });
      res.end();
    });
    servers.push(thief, redirector);
    const { backend, input } = await setup();
    await backend.saveConfig({ ...input, serverUrl: redirector.url });
    expect(await thrown(() => backend.download())).toBeInstanceOf(NetworkError);
    expect(stolen).toBe(0);
  });

  it('keeps the password out of every thrown error message', async () => {
    const { backend, input } = await setup();
    await backend.saveConfig({ ...input, password: 'wrong-secret-xyz' });
    const error = await thrown(() => backend.download());
    expect((error as Error).message).not.toContain('wrong-secret-xyz');
  });
});

describe('the sync engine through the whole main-process stack', () => {
  /** Adapts the backend (what IPC would call) to the SyncProvider the renderer engine uses. */
  const asProvider = (backend: MainSyncBackend): SyncProvider => ({
    download: (): Promise<DownloadResult> => backend.download(),
    upload: (data, etag) => backend.upload(data, etag),
  });

  it('two devices converge through one WebDAV server', async () => {
    const dav = new FakeWebDavServer();
    const a = await setup({ dav });
    const b = await setup({ dav });
    // setup() of b re-sets expectedAuthorization (same value) and serves the same fake.
    await a.backend.saveConfig(a.input);
    await b.backend.saveConfig({ ...b.input, serverUrl: b.server.url });

    const storeA = new MemoryLocalStore([makeEntry({ tmdbId: 1 })]);
    const storeB = new MemoryLocalStore([makeEntry({ tmdbId: 2 })]);
    const engineA = new SyncEngine({
      provider: asProvider(a.backend),
      store: storeA,
      now: () => NOW,
    });
    const engineB = new SyncEngine({
      provider: asProvider(b.backend),
      store: storeB,
      now: () => NOW,
    });

    await engineA.sync();
    await engineB.sync();
    await engineA.sync();

    const ids = (await storeA.getAll()).map((e) => e.id);
    expect(ids).toEqual(['movie:1', 'movie:2']);
    expect(await storeB.getAll()).toEqual(await storeA.getAll());
    expect(parseSyncFile(dav.readFile(FILE)!.body).entries).toHaveLength(2);
  });

  it('resolves a same-record edit conflict by last-writer-wins', async () => {
    const dav = new FakeWebDavServer();
    const a = await setup({ dav });
    const b = await setup({ dav });
    await a.backend.saveConfig(a.input);
    await b.backend.saveConfig({ ...b.input, serverUrl: b.server.url });
    const base = makeEntry({ status: 'want', updatedAt: isoAt(-5000) });
    const storeA = new MemoryLocalStore([base]);
    const storeB = new MemoryLocalStore([base]);
    const engineA = new SyncEngine({
      provider: asProvider(a.backend),
      store: storeA,
      now: () => NOW,
    });
    const engineB = new SyncEngine({
      provider: asProvider(b.backend),
      store: storeB,
      now: () => NOW,
    });
    await engineA.sync();
    await engineB.sync();

    storeA.put({ ...base, status: 'watching', updatedAt: isoAt(-2000) });
    storeB.put({ ...base, status: 'watched', rating: 10, updatedAt: isoAt(-1000) });
    await engineA.sync();
    await engineB.sync();
    await engineA.sync();

    for (const store of [storeA, storeB]) {
      expect(store.get(base.id)).toMatchObject({ status: 'watched', rating: 10 });
    }
  });

  it('a corrupted remote file stops the sync without overwriting it', async () => {
    const dav = new FakeWebDavServer();
    const a = await setup({ dav });
    await a.backend.saveConfig(a.input);
    dav.writeFile(FILE, serializeSyncFile([]).replace('"schemaVersion": 1', '"schemaVersion": 99'));
    const before = dav.readFile(FILE)?.body;
    const store = new MemoryLocalStore([makeEntry()]);
    const engine = new SyncEngine({ provider: asProvider(a.backend), store, now: () => NOW });
    await expect(engine.sync()).rejects.toMatchObject({ code: 'schema', reason: 'newer-version' });
    expect(dav.readFile(FILE)?.body).toBe(before);
    expect(await store.getAll()).toHaveLength(1);
  });
});
