export const SCHEMA_VERSION = 1;

export type MediaType = 'movie' | 'tv';
export type WatchStatus = 'want' | 'watching' | 'watched';

export const MEDIA_TYPES: readonly MediaType[] = ['movie', 'tv'];
export const WATCH_STATUSES: readonly WatchStatus[] = ['want', 'watching', 'watched'];

/**
 * One list entry. Timestamps are strictly UTC ISO 8601 with milliseconds and `Z`.
 * The metadata copy (title ... tmdbRating) is an offline fallback; refreshing it must not touch `updatedAt`.
 */
export interface MovieEntry {
  /** Deterministic: `"{mediaType}:{tmdbId}"`. */
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  originalTitle: string;
  year?: number;
  posterPath?: string;
  overview: string;
  genres: string[];
  tmdbRating?: number;
  status: WatchStatus;
  /** Integer 1-10. */
  rating?: number;
  note?: string;
  /** Where the recommendation came from. */
  source?: string;
  addedAt: string;
  updatedAt: string;
  /** Tombstone marker. */
  deleted: boolean;
}

export interface SyncFile {
  schemaVersion: number;
  entries: MovieEntry[];
}

export function entryId(mediaType: MediaType, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}
