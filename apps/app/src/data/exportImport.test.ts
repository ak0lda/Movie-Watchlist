import { SchemaError, parseSyncFile } from '@movie-watchlist/core';
import { describe, expect, it } from 'vitest';
import { T0, createTestServices, makeItem } from '../testing/helpers';
import { exportToJson, importFromJson } from './exportImport';

describe('export', () => {
  it('writes the sync-file format including tombstones', async () => {
    const { services } = createTestServices();
    await services.repo.add(makeItem({ tmdbId: 1, title: 'A' }));
    await services.repo.add(makeItem({ tmdbId: 2, title: 'B' }));
    await services.repo.remove('movie:2');
    const parsed = parseSyncFile(await exportToJson(services.repo));
    expect(parsed.entries.map((e) => [e.id, e.deleted])).toEqual([
      ['movie:1', false],
      ['movie:2', true],
    ]);
  });
});

describe('import', () => {
  it('merges into an empty list', async () => {
    const source = createTestServices().services;
    await source.repo.add(makeItem({ tmdbId: 1 }));
    const target = createTestServices().services;
    const result = await importFromJson(target.repo, await exportToJson(source.repo), T0);
    expect(result).toEqual({ total: 1, changed: 1 });
    expect(await target.repo.getAll()).toEqual(await source.repo.getAll());
  });

  it('never replaces: a newer local record survives and unrelated local entries stay', async () => {
    let now = T0;
    const source = createTestServices({ now: () => now }).services;
    await source.repo.add(makeItem({ tmdbId: 1 }));
    const text = await exportToJson(source.repo);

    now = new Date(T0.getTime() + 60_000);
    const target = createTestServices({ now: () => now }).services;
    await target.repo.add(makeItem({ tmdbId: 1 }));
    await target.repo.update('movie:1', { status: 'watched', rating: 10 });
    await target.repo.add(makeItem({ tmdbId: 2, title: 'Local only' }));

    const result = await importFromJson(target.repo, text, now);
    expect(result).toEqual({ total: 1, changed: 0 });
    expect((await target.repo.get('movie:1'))?.status).toBe('watched');
    expect(await target.repo.get('movie:2')).toBeDefined();
  });

  it('rejects a newer schemaVersion without writing anything', async () => {
    const { services } = createTestServices();
    await services.repo.add(makeItem());
    const before = await services.repo.getAll();
    await expect(
      importFromJson(services.repo, JSON.stringify({ schemaVersion: 99, entries: [] }), T0),
    ).rejects.toMatchObject({ reason: 'newer-version' });
    expect(await services.repo.getAll()).toEqual(before);
  });

  it.each(['not json', '[]', JSON.stringify({ schemaVersion: 1, entries: [{ id: 'x' }] })])(
    'rejects an invalid file: %s',
    async (text) => {
      const { services } = createTestServices();
      await expect(importFromJson(services.repo, text, T0)).rejects.toBeInstanceOf(SchemaError);
      expect(await services.repo.getAll()).toEqual([]);
    },
  );
});
