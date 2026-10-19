import {
  CatalogError,
  type CatalogDetails,
  type CatalogItem,
  type CatalogProvider,
  type MediaType,
} from '@movie-watchlist/core';
import { WatchlistDb } from '../data/db';
import { MetaCache } from '../data/metaCache';
import { EntryRepository } from '../data/repository';
import type { Services } from '../services';
import { SettingsStore } from '../settings/settings';

export const T0 = new Date('2026-10-19T12:00:00.000Z');

export function makeItem(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    mediaType: 'movie',
    tmdbId: 438631,
    title: 'Dune',
    originalTitle: 'Dune',
    year: 2021,
    posterPath: '/dune.jpg',
    overview: 'Paul Atreides travels to Arrakis.',
    tmdbRating: 7.8,
    ...overrides,
  };
}

export function makeDetails(overrides: Partial<CatalogDetails> = {}): CatalogDetails {
  return { ...makeItem(), genres: ['Science Fiction', 'Adventure'], ...overrides };
}

/** In-memory CatalogProvider that records calls. */
export class FakeCatalog implements CatalogProvider {
  readonly supportedLanguages = ['ru', 'en'];
  searchCalls: { query: string; language: string }[] = [];
  detailsCalls: { mediaType: MediaType; tmdbId: number; language: string }[] = [];
  searchResults: CatalogItem[] = [];
  details = new Map<string, CatalogDetails>();
  searchError: Error | undefined;
  detailsError: Error | undefined;

  search(query: string, language: string): Promise<CatalogItem[]> {
    this.searchCalls.push({ query, language });
    return this.searchError
      ? Promise.reject(this.searchError)
      : Promise.resolve(this.searchResults);
  }

  getDetails(mediaType: MediaType, tmdbId: number, language: string): Promise<CatalogDetails> {
    this.detailsCalls.push({ mediaType, tmdbId, language });
    if (this.detailsError) return Promise.reject(this.detailsError);
    const found = this.details.get(`${mediaType}:${tmdbId}`);
    return found
      ? Promise.resolve(found)
      : Promise.reject(new CatalogError('not-found', 'no such title'));
  }
}

let dbCounter = 0;

/** Fresh isolated Dexie database (fake-indexeddb) plus every service the UI needs. */
export function createTestServices(options: { now?: () => Date; tmdbKey?: string } = {}) {
  dbCounter += 1;
  const db = new WatchlistDb(`test-db-${dbCounter}`);
  const now = options.now ?? (() => T0);
  const catalog = new FakeCatalog();
  const settings = new SettingsStore();
  if (options.tmdbKey) settings.set({ tmdbKey: options.tmdbKey, apiBaseUrl: '', imageBaseUrl: '' });
  const services: Services = {
    repo: new EntryRepository(db, now),
    metaCache: new MetaCache(db, () => now().getTime()),
    catalog,
    settings,
    tmdbEnvKey: '',
  };
  return { db, catalog, settings, services };
}
