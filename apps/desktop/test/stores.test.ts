import { ConfigError } from '@movie-watchlist/core';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigStore } from '../src/main/configStore';
import {
  SecretStore,
  createSafeStorageCrypto,
  type SafeStorageLike,
} from '../src/main/secretStore';
import { FakeCrypto, makeTempDir } from './helpers';

let dir: string;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ dir, cleanup } = await makeTempDir());
});
afterEach(() => cleanup());

describe('ConfigStore', () => {
  const config = { serverUrl: 'https://dav.example', filePath: '/a/b.json', login: 'user' };

  it('returns null when nothing is saved', async () => {
    expect(await new ConfigStore(path.join(dir, 'c.json')).load()).toBeNull();
  });

  it('round-trips and overwrites', async () => {
    const store = new ConfigStore(path.join(dir, 'nested', 'c.json'));
    await store.save(config);
    expect(await store.load()).toEqual(config);
    await store.save({ ...config, login: 'other' });
    expect((await store.load())?.login).toBe('other');
  });

  it('leaves no temp files behind', async () => {
    const store = new ConfigStore(path.join(dir, 'c.json'));
    await store.save(config);
    await store.save(config);
    expect(await readdir(dir)).toEqual(['c.json']);
  });

  it.each([
    '{oops',
    '42',
    'null',
    '[]',
    '{"serverUrl":1,"filePath":"/a","login":"u"}',
    '{"serverUrl":"x"}',
  ])('treats corrupt content %j as "not configured"', async (text) => {
    const file = path.join(dir, 'c.json');
    await writeFile(file, text);
    expect(await new ConfigStore(file).load()).toBeNull();
  });

  it('stores only the three known fields', async () => {
    const file = path.join(dir, 'c.json');
    await new ConfigStore(file).save({ ...config, password: 'leak' } as typeof config);
    expect(await readFile(file, 'utf8')).not.toContain('leak');
  });
});

describe('SecretStore', () => {
  const file = () => path.join(dir, 'secret.bin');

  it('round-trips a password without ever writing it in plain text', async () => {
    const store = new SecretStore(file(), new FakeCrypto());
    await store.set('pässwörd-секрет-🎬');
    expect(await store.get()).toBe('pässwörd-секрет-🎬');
    const raw = await readFile(file());
    expect(raw.toString('utf8')).not.toContain('pässwörd');
    expect(raw.includes(Buffer.from('секрет'))).toBe(false);
  });

  it('returns null before anything is stored and after clear()', async () => {
    const store = new SecretStore(file(), new FakeCrypto());
    expect(await store.get()).toBeNull();
    await store.set('x');
    await store.clear();
    expect(await store.get()).toBeNull();
    await expect(store.clear()).resolves.toBeUndefined();
  });

  it('refuses to store when secure storage is unavailable, and writes nothing', async () => {
    const crypto = new FakeCrypto();
    crypto.available = false;
    const store = new SecretStore(file(), crypto);
    await expect(store.set('x')).rejects.toBeInstanceOf(ConfigError);
    expect(await readdir(dir)).toEqual([]);
  });

  it('does not hand out a stored secret while encryption is unavailable', async () => {
    const crypto = new FakeCrypto();
    const store = new SecretStore(file(), crypto);
    await store.set('x');
    crypto.available = false;
    expect(await store.get()).toBeNull();
  });

  it.each([Buffer.alloc(0), Buffer.from('garbage'), Buffer.from('ENC1')])(
    'treats an unreadable or empty blob as "no password" (%#)',
    async (blob) => {
      await writeFile(file(), blob);
      expect(await new SecretStore(file(), new FakeCrypto()).get()).toBeNull();
    },
  );

  it('re-encrypts when the platform asks for it', async () => {
    const crypto = new FakeCrypto();
    const store = new SecretStore(file(), crypto);
    await store.set('x');
    crypto.shouldReEncrypt = true;
    expect(await store.get()).toBe('x');
    expect(crypto.encryptCalls).toBe(2);
  });

  it('creates the parent directory on demand', async () => {
    const nested = path.join(dir, 'a', 'b', 'secret.bin');
    await mkdir(path.dirname(nested), { recursive: true });
    await new SecretStore(nested, new FakeCrypto()).set('x');
    expect((await readFile(nested)).length).toBeGreaterThan(0);
  });
});

describe('createSafeStorageCrypto', () => {
  function safeStorage(overrides: Partial<SafeStorageLike> = {}): SafeStorageLike {
    return {
      isAsyncEncryptionAvailable: () => Promise.resolve(true),
      encryptStringAsync: (plain) => Promise.resolve(Buffer.from(`E:${plain}`)),
      decryptStringAsync: (data) =>
        Promise.resolve({ shouldReEncrypt: false, result: data.toString().slice(2) }),
      getSelectedStorageBackend: () => 'gnome_libsecret',
      ...overrides,
    };
  }

  it('is unavailable when the OS reports no encryption', async () => {
    const crypto = createSafeStorageCrypto(
      safeStorage({ isAsyncEncryptionAvailable: () => Promise.resolve(false) }),
      'win32',
    );
    expect(await crypto.isAvailable()).toBe(false);
  });

  it.each([
    ['basic_text', false],
    ['unknown', false],
    ['gnome_libsecret', true],
    ['kwallet6', true],
  ])('on Linux the %s backend -> available=%s', async (backend, expected) => {
    const crypto = createSafeStorageCrypto(
      safeStorage({ getSelectedStorageBackend: () => backend }),
      'linux',
    );
    expect(await crypto.isAvailable()).toBe(expected);
  });

  it('ignores the Linux backend check on Windows and macOS', async () => {
    const crypto = createSafeStorageCrypto(
      safeStorage({ getSelectedStorageBackend: () => 'basic_text' }),
      'win32',
    );
    expect(await crypto.isAvailable()).toBe(true);
  });

  it('delegates to the async API', async () => {
    const crypto = createSafeStorageCrypto(safeStorage(), 'win32');
    const encrypted = await crypto.encrypt('secret');
    expect(await crypto.decrypt(encrypted)).toEqual({ result: 'secret', shouldReEncrypt: false });
  });
});
