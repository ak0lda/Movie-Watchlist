import { ConfigError, NetworkError } from '@movie-watchlist/core';
import { FakeWebDavServer } from '@movie-watchlist/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { FakeSecureStorage, MemoryStorage, ServerBackedPlugin } from '../../testing/platformFakes';
import { createCapacitorTransport } from './CapacitorTransport';
import {
  LocalStorageConfigPort,
  SYNC_CONFIG_STORAGE_KEY,
  SYNC_PASSWORD_KEY,
  SecureStorageSecretPort,
} from './storage';

const thrown = (run: () => Promise<unknown>) =>
  run().then(
    () => undefined,
    (e: unknown) => e,
  );

describe('createCapacitorTransport', () => {
  it('passes any WebDAV verb, headers and body to the plugin untouched', async () => {
    const request = vi.fn(() => Promise.resolve({ status: 201, headers: {}, body: '' }));
    const transport = createCapacitorTransport({ request });
    await transport.request({
      method: 'MKCOL',
      url: 'https://dav.example/Apps/',
      headers: { Authorization: 'Basic eA==', 'If-None-Match': '*' },
    });
    await transport.request({
      method: 'PUT',
      url: 'https://dav.example/f',
      headers: {},
      body: 'тело',
    });
    expect(request.mock.calls).toEqual([
      [
        {
          method: 'MKCOL',
          url: 'https://dav.example/Apps/',
          headers: { Authorization: 'Basic eA==', 'If-None-Match': '*' },
        },
      ],
      [{ method: 'PUT', url: 'https://dav.example/f', headers: {}, body: 'тело' }],
    ]);
  });

  it('lower-cases response header names and tolerates missing fields', async () => {
    const transport = createCapacitorTransport({
      request: () =>
        Promise.resolve({ status: 200, headers: { ETag: '"v1"', 'Content-Type': 'x' }, body: 'b' }),
    });
    expect(await transport.request({ method: 'GET', url: 'https://x', headers: {} })).toEqual({
      status: 200,
      headers: { etag: '"v1"', 'content-type': 'x' },
      body: 'b',
    });
    const sparse = createCapacitorTransport({
      request: () => Promise.resolve({ status: 204 } as never),
    });
    expect(await sparse.request({ method: 'GET', url: 'https://x', headers: {} })).toEqual({
      status: 204,
      headers: {},
      body: '',
    });
  });

  it('turns plugin rejections into NetworkError without forwarding their text', async () => {
    const cause = Object.assign(new Error('failed to connect to https://dav.example/secret-path'), {
      code: 'NETWORK',
    });
    const transport = createCapacitorTransport({ request: () => Promise.reject(cause) });
    const error = await thrown(() =>
      transport.request({ method: 'GET', url: 'https://x', headers: {} }),
    );
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).message).not.toContain('secret-path');
    expect((error as NetworkError).cause).toBe(cause);
  });

  it('behaves like a server for the whole WebDAV flow', async () => {
    const server = new FakeWebDavServer();
    const transport = createCapacitorTransport(new ServerBackedPlugin(server));
    expect(
      (await transport.request({ method: 'MKCOL', url: 'https://dav.example/a/', headers: {} }))
        .status,
    ).toBe(201);
    expect(
      (await transport.request({ method: 'MKCOL', url: 'https://dav.example/a/', headers: {} }))
        .status,
    ).toBe(405);
    const put = await transport.request({
      method: 'PUT',
      url: 'https://dav.example/a/f',
      headers: { 'If-None-Match': '*' },
      body: 'x',
    });
    expect(put.status).toBe(201);
    expect(put.headers['etag']).toBeDefined();
  });
});

describe('LocalStorageConfigPort', () => {
  const config = { serverUrl: 'https://dav.example', filePath: '/a.json', login: 'user' };

  it('round-trips the non-secret settings', async () => {
    const port = new LocalStorageConfigPort(new MemoryStorage());
    expect(await port.load()).toBeNull();
    await port.save(config);
    expect(await port.load()).toEqual(config);
  });

  it('stores only the three known fields (a password can never end up in localStorage)', async () => {
    const storage = new MemoryStorage();
    await new LocalStorageConfigPort(storage).save({
      ...config,
      password: 'leak',
    } as typeof config);
    expect(storage.data.get(SYNC_CONFIG_STORAGE_KEY)).not.toContain('leak');
  });

  it.each([
    '{oops',
    '42',
    'null',
    '{"serverUrl":1,"filePath":"/a","login":"u"}',
    '{"serverUrl":"x"}',
  ])('treats corrupt content %j as "not configured"', async (raw) => {
    const storage = new MemoryStorage();
    storage.setItem(SYNC_CONFIG_STORAGE_KEY, raw);
    expect(await new LocalStorageConfigPort(storage).load()).toBeNull();
  });
});

describe('SecureStorageSecretPort', () => {
  it('keeps the password under one key in secure storage only', async () => {
    const secure = new FakeSecureStorage();
    const port = new SecureStorageSecretPort(secure);
    expect(await port.get()).toBeNull();
    await port.set('пароль-🔑');
    expect(await port.get()).toBe('пароль-🔑');
    expect([...secure.data.keys()]).toEqual([SYNC_PASSWORD_KEY]);
    await port.clear();
    expect(await port.get()).toBeNull();
  });

  it('treats read failures and empty values as "no password"', async () => {
    const failing = new SecureStorageSecretPort({
      getItem: () => Promise.reject(new Error('cannot decrypt')),
      setItem: () => Promise.resolve(),
      removeItem: () => Promise.resolve(),
    });
    expect(await failing.get()).toBeNull();
    const secure = new FakeSecureStorage();
    secure.data.set(SYNC_PASSWORD_KEY, '');
    expect(await new SecureStorageSecretPort(secure).get()).toBeNull();
  });

  it('reports an unusable keystore as a ConfigError and stores nothing', async () => {
    const secure = new FakeSecureStorage();
    secure.failSet = true;
    expect(await thrown(() => new SecureStorageSecretPort(secure).set('x'))).toBeInstanceOf(
      ConfigError,
    );
    expect(secure.data.size).toBe(0);
  });

  it('ignores errors when clearing something that is not there', async () => {
    const port = new SecureStorageSecretPort({
      getItem: () => Promise.resolve(null),
      setItem: () => Promise.resolve(),
      removeItem: () => Promise.reject(new Error('missingKey')),
    });
    await expect(port.clear()).resolves.toBeUndefined();
  });
});
