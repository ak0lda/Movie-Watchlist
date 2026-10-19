import type { CatalogDetails, MediaType, MovieEntry } from '@movie-watchlist/core';
import Dexie, { type Table } from 'dexie';

/** Cached TMDB details per language. Never part of the sync file. */
export interface MetaCacheRow {
  mediaType: MediaType;
  tmdbId: number;
  lang: string;
  /** Epoch ms of the fetch. */
  fetchedAt: number;
  details: CatalogDetails;
}

export const DB_NAME = 'movie-watchlist';

/**
 * Schema versions: add a new `this.version(n).stores({...}).upgrade(tx => ...)` block for every
 * change and never edit an existing one. Booleans are not valid IndexedDB keys, so `deleted` is
 * deliberately not indexed.
 */
export class WatchlistDb extends Dexie {
  entries!: Table<MovieEntry, string>;
  metaCache!: Table<MetaCacheRow, [MediaType, number, string]>;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores({
      entries: 'id, status, addedAt, updatedAt',
      metaCache: '[mediaType+tmdbId+lang], fetchedAt',
    });
  }
}
