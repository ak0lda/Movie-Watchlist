import { describe, expect, it } from 'vitest';
import { SchemaError } from './errors';
import { migrateSyncFile, parseSyncFile, serializeSyncFile, validateEntry } from './syncFile';
import { DAY_MS, isoAt, makeEntry } from './testing/factories';

const fileWith = (entries: unknown[], schemaVersion: unknown = 1) =>
  JSON.stringify({ schemaVersion, entries });

function schemaError(run: () => unknown): SchemaError {
  try {
    run();
  } catch (error) {
    if (error instanceof SchemaError) return error;
    throw error;
  }
  throw new Error('expected SchemaError');
}

describe('serialize / parse', () => {
  it('round-trips entries, including optional fields', () => {
    const entries = [
      makeEntry({ tmdbId: 2, rating: 8, note: 'кириллица', source: 'друг Вася', year: 1999 }),
      makeEntry({
        tmdbId: 1,
        mediaType: 'tv',
        posterPath: '/p.jpg',
        tmdbRating: 8.7,
        deleted: true,
      }),
    ];
    const parsed = parseSyncFile(serializeSyncFile(entries));
    expect(parsed.schemaVersion).toBe(1);
    // Sorted by id: 'movie:2' < 'tv:1'.
    expect(parsed.entries).toEqual([entries[0], entries[1]]);
  });

  it('is deterministic regardless of entry order', () => {
    const a = makeEntry({ tmdbId: 1 });
    const b = makeEntry({ tmdbId: 2 });
    expect(serializeSyncFile([a, b])).toBe(serializeSyncFile([b, a]));
  });

  it('collapses duplicate ids in a file using the merge rule', () => {
    const older = makeEntry({ note: 'old', updatedAt: isoAt(-2 * DAY_MS) });
    const newer = makeEntry({ note: 'new', updatedAt: isoAt(-DAY_MS) });
    expect(parseSyncFile(fileWith([older, newer])).entries).toEqual([newer]);
  });

  it('keeps an expired tombstone when it wins over a duplicate, so it still propagates', () => {
    // Regression: same id and updatedAt, the tombstone wins the tie-break (canonical "true" > "false").
    const at = isoAt(-200 * DAY_MS);
    const tomb = makeEntry({ deleted: true, updatedAt: at });
    const live = makeEntry({ deleted: false, updatedAt: at });
    expect(parseSyncFile(fileWith([tomb, live])).entries).toEqual([tomb]);
    expect(parseSyncFile(fileWith([live, tomb])).entries).toEqual([tomb]);
  });

  it('drops unknown fields', () => {
    const raw = { ...makeEntry(), extra: 'x' };
    expect(validateEntry(raw)).toEqual(makeEntry());
  });
});

describe('schemaVersion', () => {
  it('a newer version raises SchemaError(newer-version) with the found version', () => {
    const error = schemaError(() => parseSyncFile(fileWith([], 2)));
    expect(error.reason).toBe('newer-version');
    expect(error.foundVersion).toBe(2);
    expect(error.code).toBe('schema');
  });

  it.each([undefined, 0, 1.5, '1', null])('rejects schemaVersion %j', (version) => {
    const text = JSON.stringify(
      version === undefined ? { entries: [] } : { schemaVersion: version, entries: [] },
    );
    expect(schemaError(() => parseSyncFile(text)).reason).toBe('invalid');
  });

  it('runs a migration chain up to the target version', () => {
    const migrated = migrateSyncFile(
      { schemaVersion: 1, entries: ['legacy'] },
      {
        1: (file) => ({ ...file, entries: [], addedByV1ToV2: true }),
        2: (file) => ({ ...file, v3: 1 }),
      },
      3,
    );
    expect(migrated).toEqual({ schemaVersion: 3, entries: [], addedByV1ToV2: true, v3: 1 });
  });

  it('fails when a migration step is missing', () => {
    expect(schemaError(() => migrateSyncFile({ schemaVersion: 1 }, {}, 2)).reason).toBe('invalid');
  });
});

describe('validation', () => {
  it('rejects malformed JSON and wrong shapes', () => {
    expect(schemaError(() => parseSyncFile('{oops')).reason).toBe('invalid');
    expect(schemaError(() => parseSyncFile('[]')).reason).toBe('invalid');
    expect(schemaError(() => parseSyncFile(JSON.stringify({ schemaVersion: 1 }))).reason).toBe(
      'invalid',
    );
  });

  it('rejects the whole file on one bad entry instead of silently skipping it', () => {
    const good = makeEntry();
    const bad = { ...makeEntry({ tmdbId: 2 }), status: 'dropped' };
    expect(() => parseSyncFile(fileWith([good, bad]))).toThrow(SchemaError);
  });

  it.each([
    ['id mismatch', { id: 'movie:1' }],
    ['non-positive tmdbId', { tmdbId: 0, id: 'movie:0' }],
    ['unknown mediaType', { mediaType: 'book' }],
    ['timestamp without ms', { updatedAt: '2026-10-19T12:00:00Z' }],
    ['timestamp with offset', { addedAt: '2026-10-19T12:00:00.000+03:00' }],
    ['rating above 10', { rating: 11 }],
    ['rating zero', { rating: 0 }],
    ['fractional rating', { rating: 7.5 }],
    ['deleted not boolean', { deleted: 'no' }],
    ['genres not strings', { genres: [1] }],
    ['null optional field', { note: null }],
  ])('rejects an entry with %s', (_name, patch) => {
    expect(() => validateEntry({ ...makeEntry(), ...patch })).toThrow(SchemaError);
  });
});
