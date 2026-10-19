import {
  canonicalize,
  entryId,
  isExpiredTombstone,
  resolveRemoteEntry,
  toUtcIso,
  type CatalogDetails,
  type CatalogItem,
  type LocalStore,
  type MovieEntry,
  type WatchStatus,
} from '@movie-watchlist/core';
import type { WatchlistDb } from './db';

export interface EntryPatch {
  status?: WatchStatus;
  /** Integer 1-10; `null` clears it. */
  rating?: number | null;
  /** Empty string or `null` clears it. */
  note?: string | null;
  source?: string | null;
}

export class EntryNotFoundError extends Error {
  constructor(id: string) {
    super(`Entry not found: ${id}`);
    this.name = 'EntryNotFoundError';
  }
}

/** Strictly after `previous`, so a local edit always beats the record it replaces (clock drift). */
function nextTimestamp(now: Date, previous?: string): string {
  const floor = previous === undefined ? -Infinity : Date.parse(previous) + 1;
  return toUtcIso(new Date(Math.max(now.getTime(), floor)));
}

function setOptionalText(
  entry: MovieEntry,
  key: 'note' | 'source',
  value: string | null | undefined,
): void {
  if (value === undefined) return;
  if (value === null || value.trim() === '') delete entry[key];
  else entry[key] = value;
}

export class EntryRepository implements LocalStore {
  constructor(
    private readonly db: WatchlistDb,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Everything including tombstones (the sync/export view). */
  getAll(): Promise<MovieEntry[]> {
    return this.db.entries.toArray();
  }

  get(id: string): Promise<MovieEntry | undefined> {
    return this.db.entries.get(id);
  }

  /** Adds an entry; revives a tombstone with fresh user fields. No-op if it is already listed. */
  add(item: CatalogItem, genres: readonly string[] = []): Promise<MovieEntry> {
    return this.db.transaction('rw', this.db.entries, async () => {
      const id = entryId(item.mediaType, item.tmdbId);
      const existing = await this.db.entries.get(id);
      if (existing && !existing.deleted) return existing;

      const stamp = nextTimestamp(this.now(), existing?.updatedAt);
      const entry: MovieEntry = {
        id,
        tmdbId: item.tmdbId,
        mediaType: item.mediaType,
        title: item.title,
        originalTitle: item.originalTitle,
        overview: item.overview,
        genres: [...genres],
        status: 'want',
        addedAt: stamp,
        updatedAt: stamp,
        deleted: false,
      };
      if (item.year !== undefined) entry.year = item.year;
      if (item.posterPath !== undefined) entry.posterPath = item.posterPath;
      if (item.tmdbRating !== undefined) entry.tmdbRating = item.tmdbRating;
      await this.db.entries.put(entry);
      return entry;
    });
  }

  update(id: string, patch: EntryPatch): Promise<MovieEntry> {
    const { rating } = patch;
    if (typeof rating === 'number' && !(Number.isInteger(rating) && rating >= 1 && rating <= 10)) {
      return Promise.reject(new RangeError('rating must be an integer from 1 to 10'));
    }
    return this.db.transaction('rw', this.db.entries, async () => {
      const current = await this.db.entries.get(id);
      if (!current || current.deleted) throw new EntryNotFoundError(id);
      const next: MovieEntry = {
        ...current,
        updatedAt: nextTimestamp(this.now(), current.updatedAt),
      };
      if (patch.status !== undefined) next.status = patch.status;
      if (rating === null) delete next.rating;
      else if (rating !== undefined) next.rating = rating;
      setOptionalText(next, 'note', patch.note);
      setOptionalText(next, 'source', patch.source);
      await this.db.entries.put(next);
      return next;
    });
  }

  /** Soft delete: the record stays as a tombstone so the deletion syncs. */
  remove(id: string): Promise<void> {
    return this.db.transaction('rw', this.db.entries, async () => {
      const current = await this.db.entries.get(id);
      if (!current || current.deleted) return;
      await this.db.entries.put({
        ...current,
        deleted: true,
        updatedAt: nextTimestamp(this.now(), current.updatedAt),
      });
    });
  }

  /**
   * Fills an incomplete metadata backup (added while TMDB details were unreachable). Complete
   * copies keep the language they were saved in, and `updatedAt` is never touched.
   */
  completeMetadata(id: string, details: CatalogDetails): Promise<void> {
    return this.db.transaction('rw', this.db.entries, async () => {
      const current = await this.db.entries.get(id);
      if (!current || current.deleted || current.genres.length > 0 || details.genres.length === 0) {
        return;
      }
      await this.db.entries.put({ ...current, genres: [...details.genres] });
    });
  }

  /** LocalStore contract: per-element merge inside one transaction, then purge old tombstones. */
  applyRemote(remote: readonly MovieEntry[], now: Date): Promise<void> {
    return this.db.transaction('rw', this.db.entries, async () => {
      for (const entry of remote) {
        const action = resolveRemoteEntry(await this.db.entries.get(entry.id), entry, now);
        if (action.type === 'put') await this.db.entries.put(action.entry);
        else if (action.type === 'delete') await this.db.entries.delete(entry.id);
      }
      await this.db.entries.filter((entry) => isExpiredTombstone(entry, now)).delete();
    });
  }
}

export function entriesDiffer(a: MovieEntry | undefined, b: MovieEntry | undefined): boolean {
  if (!a || !b) return a !== b;
  return canonicalize(a) !== canonicalize(b);
}
