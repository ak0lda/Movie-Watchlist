import { parseSyncFile, serializeSyncFile } from '@movie-watchlist/core';
import { entriesDiffer, type EntryRepository } from './repository';

export const EXPORT_FILE_NAME = 'movies.json';

/** Same format as the sync file, tombstones included. */
export async function exportToJson(repo: EntryRepository): Promise<string> {
  return serializeSyncFile(await repo.getAll());
}

export interface ImportResult {
  /** Entries in the imported file. */
  total: number;
  /** Local records that were added or replaced by a newer imported version. */
  changed: number;
}

/**
 * Import is a merge, never a replacement. Throws SchemaError for an unreadable file or a
 * schemaVersion newer than supported; nothing is written in that case.
 */
export async function importFromJson(
  repo: EntryRepository,
  text: string,
  now: Date = new Date(),
): Promise<ImportResult> {
  const { entries } = parseSyncFile(text);
  const before = new Map((await repo.getAll()).map((entry) => [entry.id, entry]));
  await repo.applyRemote(entries, now);
  const after = new Map((await repo.getAll()).map((entry) => [entry.id, entry]));
  let changed = 0;
  for (const [id, entry] of after) {
    if (entriesDiffer(before.get(id), entry)) changed += 1;
  }
  return { total: entries.length, changed };
}
