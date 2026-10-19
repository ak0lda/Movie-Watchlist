import type { CatalogDetails, MediaType } from '@movie-watchlist/core';
import type { WatchlistDb } from './db';

export const META_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedDetails {
  details: CatalogDetails;
  /** True once the TTL has elapsed: still usable, but worth refreshing. */
  stale: boolean;
}

export class MetaCache {
  constructor(
    private readonly db: WatchlistDb,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async get(
    mediaType: MediaType,
    tmdbId: number,
    lang: string,
  ): Promise<CachedDetails | undefined> {
    const row = await this.db.metaCache.get([mediaType, tmdbId, lang]);
    if (!row) return undefined;
    return { details: row.details, stale: this.now() - row.fetchedAt >= META_TTL_MS };
  }

  async put(details: CatalogDetails, lang: string): Promise<void> {
    await this.db.metaCache.put({
      mediaType: details.mediaType,
      tmdbId: details.tmdbId,
      lang,
      fetchedAt: this.now(),
      details,
    });
  }
}
