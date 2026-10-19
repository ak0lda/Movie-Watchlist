import { CatalogError } from '@movie-watchlist/core';
import { describe, expect, it } from 'vitest';
import { createTestServices, makeDetails, makeItem } from '../testing/helpers';
import { addTitle } from './addEntry';

describe('addTitle', () => {
  it('takes genres from fresh details and caches them', async () => {
    const { services, catalog } = createTestServices();
    catalog.details.set('movie:438631', makeDetails({ genres: ['Drama'] }));
    const added = await addTitle(services, makeItem(), 'en');
    expect(added.genres).toEqual(['Drama']);
    expect((await services.metaCache.get('movie', 438631, 'en'))?.details.genres).toEqual([
      'Drama',
    ]);
  });

  it('prefers the cache over the network', async () => {
    const { services, catalog } = createTestServices();
    await services.metaCache.put(makeDetails({ genres: ['Cached'] }), 'en');
    const added = await addTitle(services, makeItem(), 'en');
    expect(added.genres).toEqual(['Cached']);
    expect(catalog.detailsCalls).toEqual([]);
  });

  it('still adds the title when details cannot be loaded', async () => {
    const { services, catalog } = createTestServices();
    catalog.detailsError = new CatalogError('network', 'offline');
    const added = await addTitle(services, makeItem(), 'en');
    expect(added).toMatchObject({ id: 'movie:438631', genres: [] });
    expect(await services.repo.get('movie:438631')).toBeDefined();
  });

  it('requests details in the current language', async () => {
    const { services, catalog } = createTestServices();
    catalog.details.set('movie:438631', makeDetails());
    await addTitle(services, makeItem(), 'ru');
    expect(catalog.detailsCalls).toEqual([{ mediaType: 'movie', tmdbId: 438631, language: 'ru' }]);
  });
});
