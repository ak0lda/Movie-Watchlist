import { describe, expect, it } from 'vitest';
import { T0, createTestServices, makeDetails } from '../testing/helpers';
import { META_TTL_MS } from './metaCache';

describe('MetaCache', () => {
  it('returns undefined for a missing key', async () => {
    const { services } = createTestServices();
    expect(await services.metaCache.get('movie', 1, 'en')).toBeUndefined();
  });

  it('stores one row per (mediaType, tmdbId, language)', async () => {
    const { services } = createTestServices();
    await services.metaCache.put(makeDetails({ title: 'Dune' }), 'en');
    await services.metaCache.put(makeDetails({ title: 'Дюна' }), 'ru');
    expect((await services.metaCache.get('movie', 438631, 'en'))?.details.title).toBe('Dune');
    expect((await services.metaCache.get('movie', 438631, 'ru'))?.details.title).toBe('Дюна');
    expect(await services.metaCache.get('tv', 438631, 'en')).toBeUndefined();
  });

  it('is fresh before the TTL and stale at or after it', async () => {
    let now = T0.getTime();
    const { services, db } = createTestServices();
    const { MetaCache } = await import('./metaCache');
    const cache = new MetaCache(db, () => now);
    await cache.put(makeDetails(), 'en');

    now = T0.getTime() + META_TTL_MS - 1;
    expect((await cache.get('movie', 438631, 'en'))?.stale).toBe(false);
    now = T0.getTime() + META_TTL_MS;
    expect((await cache.get('movie', 438631, 'en'))?.stale).toBe(true);
    void services;
  });

  it('is not part of the sync data', async () => {
    const { services } = createTestServices();
    await services.metaCache.put(makeDetails(), 'en');
    expect(await services.repo.getAll()).toEqual([]);
  });
});
