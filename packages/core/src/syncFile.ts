import { canonicalObject, compareIds } from './canonical';
import { SchemaError } from './errors';
import { dedupeById } from './merge';
import { isUtcIsoTimestamp } from './timestamp';
import {
  MEDIA_TYPES,
  SCHEMA_VERSION,
  WATCH_STATUSES,
  entryId,
  type MediaType,
  type MovieEntry,
  type SyncFile,
  type WatchStatus,
} from './types';

type Raw = Record<string, unknown>;
export type SyncFileMigration = (file: Raw) => Raw;

/** `MIGRATIONS[n]` upgrades a file of schemaVersion `n` to `n + 1`. Empty while only v1 exists. */
export const MIGRATIONS: Readonly<Record<number, SyncFileMigration>> = {};

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function invalid(message: string, cause?: unknown): never {
  throw new SchemaError('invalid', message, cause === undefined ? {} : { cause });
}

function requireString(raw: Raw, key: string, path: string): string {
  const value = raw[key];
  if (typeof value !== 'string') invalid(`${path}.${key} must be a string`);
  return value;
}

function optionalString(raw: Raw, key: string, path: string): string | undefined {
  return raw[key] === undefined ? undefined : requireString(raw, key, path);
}

function optionalNumber(
  raw: Raw,
  key: string,
  path: string,
  check: (n: number) => boolean,
  expected: string,
): number | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || !check(value)) {
    invalid(`${path}.${key} must be ${expected}`);
  }
  return value;
}

function requireTimestamp(raw: Raw, key: string, path: string): string {
  const value = raw[key];
  if (!isUtcIsoTimestamp(value)) invalid(`${path}.${key} must be a UTC ISO 8601 timestamp with ms`);
  return value;
}

/** Strict validation; unknown fields are dropped. Throws SchemaError instead of skipping an entry. */
export function validateEntry(raw: unknown, path = 'entry'): MovieEntry {
  if (!isRecord(raw)) invalid(`${path} must be an object`);

  const mediaType = raw['mediaType'];
  if (!MEDIA_TYPES.some((t) => t === mediaType)) invalid(`${path}.mediaType is invalid`);
  const status = raw['status'];
  if (!WATCH_STATUSES.some((s) => s === status)) invalid(`${path}.status is invalid`);
  const tmdbId = raw['tmdbId'];
  if (typeof tmdbId !== 'number' || !Number.isInteger(tmdbId) || tmdbId <= 0) {
    invalid(`${path}.tmdbId must be a positive integer`);
  }
  const genres = raw['genres'];
  if (!Array.isArray(genres) || !genres.every((g) => typeof g === 'string')) {
    invalid(`${path}.genres must be an array of strings`);
  }
  if (typeof raw['deleted'] !== 'boolean') invalid(`${path}.deleted must be a boolean`);

  const id = requireString(raw, 'id', path);
  if (id !== entryId(mediaType as MediaType, tmdbId))
    invalid(`${path}.id does not match mediaType:tmdbId`);

  const entry: MovieEntry = {
    id,
    tmdbId,
    mediaType: mediaType as MediaType,
    title: requireString(raw, 'title', path),
    originalTitle: requireString(raw, 'originalTitle', path),
    overview: requireString(raw, 'overview', path),
    genres: genres as string[],
    status: status as WatchStatus,
    addedAt: requireTimestamp(raw, 'addedAt', path),
    updatedAt: requireTimestamp(raw, 'updatedAt', path),
    deleted: raw['deleted'],
  };

  const year = optionalNumber(raw, 'year', path, Number.isInteger, 'an integer');
  if (year !== undefined) entry.year = year;
  const posterPath = optionalString(raw, 'posterPath', path);
  if (posterPath !== undefined) entry.posterPath = posterPath;
  const tmdbRating = optionalNumber(raw, 'tmdbRating', path, () => true, 'a number');
  if (tmdbRating !== undefined) entry.tmdbRating = tmdbRating;
  const rating = optionalNumber(
    raw,
    'rating',
    path,
    (n) => Number.isInteger(n) && n >= 1 && n <= 10,
    'an integer from 1 to 10',
  );
  if (rating !== undefined) entry.rating = rating;
  const note = optionalString(raw, 'note', path);
  if (note !== undefined) entry.note = note;
  const source = optionalString(raw, 'source', path);
  if (source !== undefined) entry.source = source;
  return entry;
}

/** Runs registered migrations until `target`. A missing step is an `invalid` SchemaError. */
export function migrateSyncFile(
  file: Raw,
  migrations: Readonly<Record<number, SyncFileMigration>> = MIGRATIONS,
  target: number = SCHEMA_VERSION,
): Raw {
  let current = file;
  while ((current['schemaVersion'] as number) < target) {
    const version = current['schemaVersion'] as number;
    const step = migrations[version];
    if (!step) invalid(`No migration from schemaVersion ${version}`);
    current = { ...step(current), schemaVersion: version + 1 };
  }
  return current;
}

/**
 * Parses a downloaded file. A `schemaVersion` newer than supported raises
 * `SchemaError('newer-version')` so the caller stops without overwriting the remote file.
 */
export function parseSyncFile(text: string): SyncFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    return invalid('Sync file is not valid JSON', cause);
  }
  if (!isRecord(raw)) invalid('Sync file must be a JSON object');
  const version = raw['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    invalid('schemaVersion must be a positive integer');
  }
  if (version > SCHEMA_VERSION) {
    throw new SchemaError(
      'newer-version',
      `Sync file schemaVersion ${version} is newer than supported ${SCHEMA_VERSION}`,
      { foundVersion: version },
    );
  }

  const migrated = migrateSyncFile(raw);
  const entries = migrated['entries'];
  if (!Array.isArray(entries)) invalid('entries must be an array');
  return {
    schemaVersion: SCHEMA_VERSION,
    entries: dedupeById(entries.map((entry, index) => validateEntry(entry, `entries[${index}]`))),
  };
}

/** Deterministic output: entries sorted by id, keys in canonical order. */
export function serializeSyncFile(entries: readonly MovieEntry[]): string {
  const sorted = [...entries].sort(compareIds).map(canonicalObject);
  return `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, entries: sorted }, null, 2)}\n`;
}
