import {
  CatalogError,
  type SyncConfigInput,
  type SyncConfigView,
  type SyncOutcome,
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
import type { KinopoiskResolver } from '../share/kinopoisk';
import { SyncService, type SyncRunner } from '../sync/SyncService';
import type { SyncSettingsApi } from '../sync/syncSettingsApi';

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

/** Controllable sync runner: resolves immediately unless `gate` is set. */
export class FakeRunner implements SyncRunner {
  calls = 0;
  error: unknown;
  gate: Promise<void> | undefined;

  async sync(): Promise<SyncOutcome> {
    this.calls += 1;
    await this.gate;
    if (this.error !== undefined) throw this.error;
    return { uploaded: true, attempts: 1 };
  }
}

/** In-memory stand-in for the Electron settings bridge (the password is write-only). */
export class FakeSyncSettings implements SyncSettingsApi {
  config: SyncConfigView = {
    serverUrl: 'https://webdav.yandex.ru',
    filePath: '/Apps/MovieWatchlist/movies.json',
    login: '',
    hasPassword: false,
  };
  saves: SyncConfigInput[] = [];
  clears = 0;
  error: unknown;

  getConfig(): Promise<SyncConfigView> {
    return this.error === undefined
      ? Promise.resolve({ ...this.config })
      : Promise.reject(this.error);
  }

  saveConfig(input: SyncConfigInput): Promise<SyncConfigView> {
    this.saves.push(input);
    if (this.error !== undefined) return Promise.reject(this.error);
    this.config = {
      serverUrl: input.serverUrl,
      filePath: input.filePath,
      login: input.login,
      hasPassword: this.config.hasPassword || Boolean(input.password),
    };
    return Promise.resolve({ ...this.config });
  }

  clearPassword(): Promise<SyncConfigView> {
    this.clears += 1;
    this.config = { ...this.config, hasPassword: false };
    return Promise.resolve({ ...this.config });
  }
}

let dbCounter = 0;

/** Fresh isolated Dexie database (fake-indexeddb) plus every service the UI needs. */
export function createTestServices(
  options: {
    now?: () => Date;
    tmdbKey?: string;
    sync?: boolean;
    kinopoisk?: KinopoiskResolver;
    kinopoiskKey?: string;
  } = {},
) {
  dbCounter += 1;
  const db = new WatchlistDb(`test-db-${dbCounter}`);
  const now = options.now ?? (() => T0);
  const catalog = new FakeCatalog();
  const settings = new SettingsStore();
  if (options.tmdbKey || options.kinopoiskKey) {
    settings.set({
      tmdbKey: options.tmdbKey ?? '',
      apiBaseUrl: '',
      imageBaseUrl: '',
      kinopoiskKey: options.kinopoiskKey ?? '',
    });
  }
  const services: Services = {
    repo: new EntryRepository(db, now),
    metaCache: new MetaCache(db, () => now().getTime()),
    catalog,
    settings,
    tmdbEnvKey: '',
  };
  const runner = new FakeRunner();
  const syncSettings = new FakeSyncSettings();
  const syncService = new SyncService(runner, () => now().getTime());
  if (options.sync) services.sync = { service: syncService, settings: syncSettings };
  if (options.kinopoisk) services.kinopoisk = options.kinopoisk;
  return { db, catalog, settings, services, runner, syncSettings, syncService };
}
