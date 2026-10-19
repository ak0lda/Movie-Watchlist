import { describe, expect, it } from 'vitest';
import { basicAuthHeader } from './base64';
import { AuthError, ConfigError, ConflictError } from './errors';
import {
  ConfiguredSyncBackend,
  type StoredSyncConfig,
  type SyncConfigPort,
  type SyncSecretPort,
} from './syncBackend';
import { DEFAULT_FILE_PATH, DEFAULT_SERVER_URL } from './syncDefaults';
import { FakeWebDavServer } from './testing/fakeWebDavServer';

class MemoryConfig implements SyncConfigPort {
  value: StoredSyncConfig | null = null;
  saves = 0;
  load = () => Promise.resolve(this.value);
  save = (config: StoredSyncConfig) => {
    this.value = config;
    this.saves += 1;
    return Promise.resolve();
  };
}

class MemorySecret implements SyncSecretPort {
  value: string | null = null;
  failSet = false;
  get = () => Promise.resolve(this.value);
  set = (password: string) => {
    if (this.failSet) return Promise.reject(new ConfigError('Secure storage is not available'));
    this.value = password;
    return Promise.resolve();
  };
  clear = () => {
    this.value = null;
    return Promise.resolve();
  };
}

const URL_A = 'https://dav.example';
const FILE = '/Apps/MovieWatchlist/movies.json';
const INPUT = { serverUrl: URL_A, filePath: FILE, login: 'user', password: 'pw-пароль' };

function setup(allowInsecureLoopback = false) {
  const configStore = new MemoryConfig();
  const secretStore = new MemorySecret();
  const server = new FakeWebDavServer();
  server.expectedAuthorization = basicAuthHeader('user', 'pw-пароль');
  const backend = new ConfiguredSyncBackend({
    configStore,
    secretStore,
    transport: server,
    allowInsecureLoopback,
  });
  return { backend, configStore, secretStore, server };
}

const thrown = (run: () => Promise<unknown>) =>
  run().then(
    () => undefined,
    (e: unknown) => e,
  );

describe('settings', () => {
  it('reports the documented defaults before anything is saved', async () => {
    const { backend } = setup();
    expect(await backend.getConfigView()).toEqual({
      serverUrl: DEFAULT_SERVER_URL,
      filePath: DEFAULT_FILE_PATH,
      login: '',
      hasPassword: false,
    });
  });

  it('saves, stores the password separately and never returns it', async () => {
    const { backend, configStore, secretStore } = setup();
    const view = await backend.saveConfig(INPUT);
    expect(view).toEqual({ serverUrl: URL_A, filePath: FILE, login: 'user', hasPassword: true });
    expect(JSON.stringify(view)).not.toContain('pw-');
    expect(JSON.stringify(configStore.value)).not.toContain('pw-');
    expect(secretStore.value).toBe('pw-пароль');
  });

  it('trims the server URL', async () => {
    const { backend, configStore } = setup();
    await backend.saveConfig({ ...INPUT, serverUrl: `  ${URL_A}  ` });
    expect(configStore.value?.serverUrl).toBe(URL_A);
  });

  it.each([
    ['http server', { serverUrl: 'http://dav.example' }],
    ['credentials in the URL', { serverUrl: 'https://u:p@dav.example' }],
    ['relative path', { filePath: 'movies.json' }],
    ['path traversal', { filePath: '/a/../b.json' }],
    ['empty login', { login: '' }],
    ['login with a colon', { login: 'a:b' }],
    ['login with a newline', { login: 'a\nb' }],
  ])('rejects %s and stores nothing', async (_name, patch) => {
    const { backend, configStore, secretStore } = setup();
    expect(await thrown(() => backend.saveConfig({ ...INPUT, ...patch }))).toBeInstanceOf(
      ConfigError,
    );
    expect(configStore.value).toBeNull();
    expect(secretStore.value).toBeNull();
  });

  it('allows loopback http only when enabled', async () => {
    const local = { ...INPUT, serverUrl: 'http://127.0.0.1:8080' };
    expect(await thrown(() => setup(false).backend.saveConfig(local))).toBeInstanceOf(ConfigError);
    await expect(setup(true).backend.saveConfig(local)).resolves.toMatchObject({
      hasPassword: true,
    });
  });

  it('keeps the stored password when the destination is unchanged', async () => {
    const { backend } = setup();
    await backend.saveConfig(INPUT);
    const { password, ...withoutPassword } = INPUT;
    void password;
    await expect(
      backend.saveConfig({ ...withoutPassword, filePath: '/other.json' }),
    ).resolves.toMatchObject({ filePath: '/other.json', hasPassword: true });
  });

  it.each([
    ['server', { serverUrl: 'https://evil.example' }],
    ['login', { login: 'someone-else' }],
  ])('refuses to reuse the stored password after the %s changes', async (_name, patch) => {
    const { backend, configStore } = setup();
    await backend.saveConfig(INPUT);
    const before = JSON.stringify(configStore.value);
    const { password, ...withoutPassword } = INPUT;
    void password;
    expect(await thrown(() => backend.saveConfig({ ...withoutPassword, ...patch }))).toBeInstanceOf(
      ConfigError,
    );
    expect(JSON.stringify(configStore.value)).toBe(before);
  });

  it('does not save settings when the password cannot be stored', async () => {
    const { backend, configStore, secretStore } = setup();
    secretStore.failSet = true;
    expect(await thrown(() => backend.saveConfig(INPUT))).toBeInstanceOf(ConfigError);
    expect(configStore.saves).toBe(0);
  });

  it('forgets the password', async () => {
    const { backend } = setup();
    await backend.saveConfig(INPUT);
    expect((await backend.clearPassword()).hasPassword).toBe(false);
    expect(await thrown(() => backend.download())).toBeInstanceOf(ConfigError);
  });
});

describe('sync operations', () => {
  it('refuses to sync before configuration', async () => {
    const { backend, server } = setup();
    expect(await thrown(() => backend.download())).toBeInstanceOf(ConfigError);
    expect(await thrown(() => backend.upload('x', null))).toBeInstanceOf(ConfigError);
    expect(server.requests).toHaveLength(0);
  });

  it('creates folders on the first upload and round-trips data with etags', async () => {
    const { backend, server } = setup();
    await backend.saveConfig(INPUT);
    expect(await backend.download()).toEqual({ kind: 'not-found' });
    const first = await backend.upload('{"v":1}', null);
    expect(server.hasFolder('/Apps/MovieWatchlist')).toBe(true);
    const second = await backend.upload('{"v":2}', first.etag);
    expect(second.etag).not.toBe(first.etag);
    expect(await backend.download()).toEqual({
      kind: 'found',
      data: '{"v":2}',
      etag: server.readFile(FILE)?.etag,
    });
    expect(await thrown(() => backend.upload('{"v":3}', first.etag))).toBeInstanceOf(ConflictError);
  });

  it('maps rejected credentials to AuthError', async () => {
    const { backend } = setup();
    await backend.saveConfig({ ...INPUT, password: 'wrong' });
    expect(await thrown(() => backend.download())).toBeInstanceOf(AuthError);
  });

  it('sends the stored password and nothing else secret', async () => {
    const { backend, server } = setup();
    await backend.saveConfig(INPUT);
    await backend.download();
    expect(server.requests[0]?.headers['Authorization']).toBe(basicAuthHeader('user', 'pw-пароль'));
  });
});
