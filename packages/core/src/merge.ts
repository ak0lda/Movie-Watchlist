import { canonicalize, compareIds } from './canonical';
import type { MovieEntry } from './types';

export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Last-writer-wins on the whole record. Equal `updatedAt` falls back to the greater canonical
 * serialization, so the result never depends on argument order.
 */
export function mergeEntry(a: MovieEntry, b: MovieEntry): MovieEntry {
  const diff = Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
  if (diff > 0) return a;
  if (diff < 0) return b;
  return canonicalize(a) >= canonicalize(b) ? a : b;
}

export function isExpiredTombstone(entry: MovieEntry, now: Date): boolean {
  return entry.deleted && Date.parse(entry.updatedAt) < now.getTime() - TOMBSTONE_TTL_MS;
}

/** Per-id LWW without tombstone expiry. Output is sorted by id and has unique ids. */
export function dedupeById(entries: readonly MovieEntry[]): MovieEntry[] {
  const byId = new Map<string, MovieEntry>();
  for (const entry of entries) {
    const current = byId.get(entry.id);
    byId.set(entry.id, current ? mergeEntry(current, entry) : entry);
  }
  return [...byId.values()].sort(compareIds);
}

/**
 * Pure, commutative and idempotent merge of two entry lists: per-id LWW, then tombstones older
 * than 90 days (relative to `now`) are dropped. Output is sorted by id.
 */
export function merge(a: readonly MovieEntry[], b: readonly MovieEntry[], now: Date): MovieEntry[] {
  return dedupeById([...a, ...b]).filter((entry) => !isExpiredTombstone(entry, now));
}

export type RemoteApplyAction =
  { type: 'keep' } | { type: 'put'; entry: MovieEntry } | { type: 'delete' };

/**
 * Per-element rule for applying a remote entry to a local store inside its transaction. Applying
 * every remote entry this way (plus purging local expired tombstones) equals `merge(local, remote)`
 * but never replaces the whole database, so a concurrent user edit is preserved. `remote` must have
 * unique ids (`parseSyncFile` guarantees it): an expired tombstone is dropped without a trace, so
 * a duplicate id later in the list would otherwise slip through.
 */
export function resolveRemoteEntry(
  local: MovieEntry | undefined,
  remote: MovieEntry,
  now: Date,
): RemoteApplyAction {
  const winner = local ? mergeEntry(local, remote) : remote;
  if (isExpiredTombstone(winner, now)) return local ? { type: 'delete' } : { type: 'keep' };
  if (local && canonicalize(local) === canonicalize(winner)) return { type: 'keep' };
  return { type: 'put', entry: winner };
}
