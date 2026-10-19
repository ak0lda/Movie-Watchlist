import { describe, expect, it } from 'vitest';
import { AuthError, ConflictError, NetworkError, SchemaError, StorageError } from './errors';
import { SyncEngine } from './syncEngine';
import { DAY_MS, NOW, isoAt, makeEntry } from './testing/factories';
import { FakeSyncProvider } from './testing/fakeSyncProvider';
import { MemoryLocalStore } from './testing/memoryLocalStore';
import type { MovieEntry } from './types';

function setup(local: MovieEntry[] = [], remote?: MovieEntry[]) {
  const provider = new FakeSyncProvider();
  if (remote) provider.writeRemote(remote);
  const store = new MemoryLocalStore(local);
  const engine = new SyncEngine({ provider, store, now: () => NOW });
  return { provider, store, engine };
}

const ids = (entries: readonly MovieEntry[]) => entries.map((e) => e.id).sort();

describe('first run', () => {
  it('creates the remote file (404 -> upload with null etag) when there is local data', async () => {
    const { provider, store, engine } = setup([makeEntry({ tmdbId: 1 })]);
    await expect(engine.sync()).resolves.toEqual({ uploaded: true, attempts: 1 });
    expect(ids(provider.remoteEntries())).toEqual(['movie:1']);
    expect(ids(await store.getAll())).toEqual(['movie:1']);
  });

  it('does not create an empty remote file', async () => {
    const { provider, engine } = setup();
    await expect(engine.sync()).resolves.toEqual({ uploaded: false, attempts: 1 });
    expect(provider.file).toBeNull();
    expect(provider.uploadAttempts).toBe(0);
  });
});

describe('normal cycle', () => {
  it('merges both sides locally and remotely', async () => {
    const { provider, store, engine } = setup(
      [makeEntry({ tmdbId: 1 })],
      [makeEntry({ tmdbId: 2 })],
    );
    await engine.sync();
    expect(ids(await store.getAll())).toEqual(['movie:1', 'movie:2']);
    expect(ids(provider.remoteEntries())).toEqual(['movie:1', 'movie:2']);
  });

  it('skips the upload when nothing changed', async () => {
    const entries = [makeEntry({ tmdbId: 1 })];
    const { provider, engine } = setup(entries, entries);
    await expect(engine.sync()).resolves.toEqual({ uploaded: false, attempts: 1 });
    expect(provider.uploadAttempts).toBe(0);
  });

  it('propagates a newer local tombstone to the remote file', async () => {
    const live = makeEntry({ updatedAt: isoAt(-2 * DAY_MS) });
    const tomb = makeEntry({ deleted: true, updatedAt: isoAt(-DAY_MS) });
    const { provider, engine } = setup([tomb], [live]);
    await engine.sync();
    expect(provider.remoteEntries()).toEqual([tomb]);
  });

  it('drops expired tombstones from both sides', async () => {
    const expired = makeEntry({ deleted: true, updatedAt: isoAt(-91 * DAY_MS) });
    const keep = makeEntry({ tmdbId: 2 });
    const { provider, store, engine } = setup([expired, keep], [expired]);
    await engine.sync();
    expect(ids(provider.remoteEntries())).toEqual(['movie:2']);
    expect(ids(await store.getAll())).toEqual(['movie:2']);
  });

  it('preserves a user edit made while the download was in flight', async () => {
    const original = makeEntry({ status: 'want', updatedAt: isoAt(-2 * DAY_MS) });
    const { provider, store, engine } = setup([original], [original]);
    const edit = makeEntry({ status: 'watched', rating: 9, updatedAt: isoAt(-1000) });
    provider.onDownload = () => store.put(edit);
    await engine.sync();
    expect(store.get(edit.id)).toEqual(edit);
    expect(provider.remoteEntries()).toEqual([edit]);
  });
});

describe('conflicts (412)', () => {
  it('re-downloads, merges and retries once after a concurrent write', async () => {
    const { provider, store, engine } = setup(
      [makeEntry({ tmdbId: 1 })],
      [makeEntry({ tmdbId: 2 })],
    );
    let raced = false;
    provider.onBeforeUpload = () => {
      if (raced) return;
      raced = true;
      provider.writeRemote([makeEntry({ tmdbId: 2 }), makeEntry({ tmdbId: 3 })]);
    };
    await expect(engine.sync()).resolves.toEqual({ uploaded: true, attempts: 2 });
    expect(ids(provider.remoteEntries())).toEqual(['movie:1', 'movie:2', 'movie:3']);
    expect(ids(await store.getAll())).toEqual(['movie:1', 'movie:2', 'movie:3']);
    expect(provider.downloads).toBe(2);
  });

  it('gives up with ConflictError after three conflicting attempts and keeps local data', async () => {
    const { provider, store, engine } = setup(
      [makeEntry({ tmdbId: 1 })],
      [makeEntry({ tmdbId: 2 })],
    );
    let n = 10;
    provider.onBeforeUpload = () => {
      n += 1;
      provider.writeRemote([makeEntry({ tmdbId: 2 }), makeEntry({ tmdbId: n })]);
    };
    await expect(engine.sync()).rejects.toBeInstanceOf(ConflictError);
    expect(provider.uploadAttempts).toBe(3);
    expect(provider.downloads).toBe(3);
    expect(store.get('movie:1')).toBeDefined();
  });

  it('create-only upload conflicts when another device created the file first', async () => {
    const { provider, engine } = setup([makeEntry({ tmdbId: 1 })]);
    let raced = false;
    provider.onBeforeUpload = () => {
      if (raced) return;
      raced = true;
      provider.writeRemote([makeEntry({ tmdbId: 9 })]);
    };
    await expect(engine.sync()).resolves.toEqual({ uploaded: true, attempts: 2 });
    expect(ids(provider.remoteEntries())).toEqual(['movie:1', 'movie:9']);
  });
});

describe('errors', () => {
  it('a network error on download propagates and leaves local data intact', async () => {
    const local = [makeEntry({ tmdbId: 1 })];
    const { provider, store, engine } = setup(local, [makeEntry({ tmdbId: 2 })]);
    provider.failNext('download', new NetworkError('offline'));
    await expect(engine.sync()).rejects.toBeInstanceOf(NetworkError);
    expect(await store.getAll()).toEqual(local);
  });

  it('a network error on upload keeps the already merged local data', async () => {
    const { provider, store, engine } = setup(
      [makeEntry({ tmdbId: 1 })],
      [makeEntry({ tmdbId: 2 })],
    );
    provider.failNext('upload', new NetworkError('reset'));
    await expect(engine.sync()).rejects.toBeInstanceOf(NetworkError);
    expect(ids(await store.getAll())).toEqual(['movie:1', 'movie:2']);
    expect(ids(provider.remoteEntries())).toEqual(['movie:2']);
  });

  it('propagates AuthError without retrying', async () => {
    const { provider, engine } = setup([makeEntry()]);
    provider.failNext('download', new AuthError());
    await expect(engine.sync()).rejects.toBeInstanceOf(AuthError);
    expect(provider.downloads).toBe(1);
  });

  it('wraps unexpected provider failures into NetworkError and keeps the cause', async () => {
    const { provider, engine } = setup([makeEntry()]);
    const cause = new TypeError('fetch failed');
    provider.failNext('download', cause);
    const error = await engine.sync().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).cause).toBe(cause);
  });

  it('wraps local store failures into StorageError', async () => {
    const { store, engine } = setup([], [makeEntry()]);
    store.applyError = new Error('quota');
    await expect(engine.sync()).rejects.toBeInstanceOf(StorageError);
  });

  it('a newer remote schemaVersion stops the sync without writing anything', async () => {
    const local = [makeEntry({ tmdbId: 1 })];
    const { provider, store, engine } = setup(local);
    const foreign = JSON.stringify({ schemaVersion: 99, entries: [], future: true });
    provider.writeRaw(foreign);
    const error = await engine.sync().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SchemaError);
    expect((error as SchemaError).reason).toBe('newer-version');
    expect(provider.uploadAttempts).toBe(0);
    expect(provider.file?.data).toBe(foreign);
    expect(await store.getAll()).toEqual(local);
  });

  it('an unreadable remote file is also never overwritten', async () => {
    const { provider, engine } = setup([makeEntry()]);
    provider.writeRaw('not json');
    await expect(engine.sync()).rejects.toBeInstanceOf(SchemaError);
    expect(provider.uploadAttempts).toBe(0);
    expect(provider.file?.data).toBe('not json');
  });
});

describe('single-flight', () => {
  it('concurrent sync() calls share one run, and a later call starts a new one', async () => {
    const { provider, engine } = setup([makeEntry({ tmdbId: 1 })], [makeEntry({ tmdbId: 2 })]);
    const first = engine.sync();
    const second = engine.sync();
    expect(second).toBe(first);
    await first;
    expect(provider.downloads).toBe(1);

    await engine.sync();
    expect(provider.downloads).toBe(2);
  });

  it('releases the lock after a failure', async () => {
    const { provider, engine } = setup([makeEntry()]);
    provider.failNext('download', new NetworkError());
    await expect(engine.sync()).rejects.toBeInstanceOf(NetworkError);
    await expect(engine.sync()).resolves.toMatchObject({ uploaded: true });
  });
});
