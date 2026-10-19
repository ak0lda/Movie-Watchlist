import type { MediaType, MovieEntry } from './types';

export type DownloadResult = { kind: 'found'; data: string; etag: string } | { kind: 'not-found' };

/**
 * Transport for the sync file. Implementations throw typed errors from `errors.ts`:
 * HTTP 412 (or `If-None-Match: *` on an existing file) -> ConflictError, 401/403 -> AuthError,
 * network, timeout and 5xx -> NetworkError. Creating parent folders (MKCOL per path segment,
 * treating 201 and 405 as success) is the provider's job, not the engine's.
 *
 * The etag is an opaque string: store it and send it back exactly as received (with quotes).
 */
export interface SyncProvider {
  download(): Promise<DownloadResult>;
  /** `etag === null` means "create only" (`If-None-Match: *`); otherwise `If-Match: etag`. */
  upload(data: string, etag: string | null): Promise<{ etag: string | null }>;
}

/** Local persistence as seen by the sync engine (Dexie in the app, a Map in tests). */
export interface LocalStore {
  /** All entries including tombstones. */
  getAll(): Promise<MovieEntry[]>;
  /**
   * Applies remote entries element by element inside one transaction using `resolveRemoteEntry`
   * against the current local value, then purges local expired tombstones. Must not replace the
   * whole database: user edits made during a sync must survive.
   */
  applyRemote(remote: readonly MovieEntry[], now: Date): Promise<void>;
}

export interface CatalogItem {
  mediaType: MediaType;
  tmdbId: number;
  title: string;
  originalTitle: string;
  year?: number;
  posterPath?: string;
  overview: string;
  tmdbRating?: number;
}

export interface CatalogDetails extends CatalogItem {
  genres: string[];
}

/** Structural subset of the DOM AbortSignal; core has no DOM lib. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
}

export interface CatalogProvider {
  /** Language codes the implementation can serve, e.g. `['ru', 'en']`. */
  readonly supportedLanguages: readonly string[];
  search(query: string, language: string, signal?: AbortSignalLike): Promise<CatalogItem[]>;
  getDetails(
    mediaType: MediaType,
    tmdbId: number,
    language: string,
    signal?: AbortSignalLike,
  ): Promise<CatalogDetails>;
}
