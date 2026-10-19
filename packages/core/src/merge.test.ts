import { describe, expect, it } from 'vitest';
import { canonicalize } from './canonical';
import { TOMBSTONE_TTL_MS, merge, mergeEntry, resolveRemoteEntry } from './merge';
import { DAY_MS, NOW, isoAt, makeEntry } from './testing/factories';

describe('mergeEntry', () => {
  it('the greater updatedAt wins in either order', () => {
    const older = makeEntry({ status: 'want', updatedAt: isoAt(-2 * DAY_MS) });
    const newer = makeEntry({ status: 'watched', updatedAt: isoAt(-DAY_MS) });
    expect(mergeEntry(older, newer)).toBe(newer);
    expect(mergeEntry(newer, older)).toBe(newer);
  });

  it('compares by instant, not by string, when timestamps differ by milliseconds', () => {
    const a = makeEntry({ updatedAt: '2026-10-19T11:59:59.999Z', note: 'a' });
    const b = makeEntry({ updatedAt: '2026-10-19T12:00:00.000Z', note: 'b' });
    expect(mergeEntry(a, b).note).toBe('b');
  });

  it('breaks ties by the greater canonical serialization, independent of order', () => {
    const at = isoAt(-DAY_MS);
    const a = makeEntry({ updatedAt: at, note: 'alpha' });
    const b = makeEntry({ updatedAt: at, note: 'beta' });
    const expected = canonicalize(a) > canonicalize(b) ? a : b;
    expect(mergeEntry(a, b)).toEqual(expected);
    expect(mergeEntry(b, a)).toEqual(expected);
  });
});

describe('merge', () => {
  it('unions entries with different ids and sorts by id', () => {
    const a = makeEntry({ tmdbId: 2 });
    const b = makeEntry({ tmdbId: 1 });
    const c = makeEntry({ tmdbId: 1, mediaType: 'tv' });
    expect(merge([a], [b, c], NOW).map((e) => e.id)).toEqual(['movie:1', 'movie:2', 'tv:1']);
  });

  it('a newer tombstone beats an older live entry', () => {
    const live = makeEntry({ updatedAt: isoAt(-2 * DAY_MS) });
    const tomb = makeEntry({ deleted: true, updatedAt: isoAt(-DAY_MS) });
    expect(merge([live], [tomb], NOW)).toEqual([tomb]);
  });

  it('re-adding after deletion revives the entry (newer live beats tombstone)', () => {
    const tomb = makeEntry({ deleted: true, updatedAt: isoAt(-2 * DAY_MS) });
    const revived = makeEntry({ deleted: false, updatedAt: isoAt(-DAY_MS) });
    expect(merge([tomb], [revived], NOW)).toEqual([revived]);
  });

  it('collapses duplicate ids inside a single list', () => {
    const older = makeEntry({ updatedAt: isoAt(-2 * DAY_MS), note: 'old' });
    const newer = makeEntry({ updatedAt: isoAt(-DAY_MS), note: 'new' });
    expect(merge([older, newer], [], NOW)).toEqual([newer]);
  });

  it('does not mutate its inputs', () => {
    const a = [Object.freeze(makeEntry({ tmdbId: 2 }))];
    const b = [Object.freeze(makeEntry({ tmdbId: 1 }))];
    expect(() => merge(a, b, NOW)).not.toThrow();
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  describe('tombstone expiry (90 days relative to now)', () => {
    const tomb = (ageMs: number) => makeEntry({ deleted: true, updatedAt: isoAt(-ageMs) });

    it('drops tombstones older than 90 days', () => {
      expect(merge([tomb(TOMBSTONE_TTL_MS + 1)], [], NOW)).toEqual([]);
      expect(merge([tomb(91 * DAY_MS)], [], NOW)).toEqual([]);
    });

    it('keeps tombstones at exactly 90 days and younger', () => {
      expect(merge([tomb(TOMBSTONE_TTL_MS)], [], NOW)).toHaveLength(1);
      expect(merge([tomb(89 * DAY_MS)], [], NOW)).toHaveLength(1);
    });

    it('never drops old live entries', () => {
      const live = makeEntry({ updatedAt: isoAt(-400 * DAY_MS) });
      expect(merge([live], [], NOW)).toEqual([live]);
    });

    it('uses the passed now, not the system clock', () => {
      const t = tomb(30 * DAY_MS);
      const later = new Date(NOW.getTime() + 100 * DAY_MS);
      expect(merge([t], [], NOW)).toHaveLength(1);
      expect(merge([t], [], later)).toEqual([]);
    });
  });
});

describe('resolveRemoteEntry', () => {
  it('keeps a newer local edit over an older remote entry', () => {
    const local = makeEntry({ status: 'watched', updatedAt: isoAt(-1000) });
    const remote = makeEntry({ status: 'want', updatedAt: isoAt(-DAY_MS) });
    expect(resolveRemoteEntry(local, remote, NOW)).toEqual({ type: 'keep' });
  });

  it('puts a newer remote entry and inserts unknown ids', () => {
    const local = makeEntry({ updatedAt: isoAt(-DAY_MS) });
    const remote = makeEntry({ status: 'watched', updatedAt: isoAt(-1000) });
    expect(resolveRemoteEntry(local, remote, NOW)).toEqual({ type: 'put', entry: remote });
    expect(resolveRemoteEntry(undefined, remote, NOW)).toEqual({ type: 'put', entry: remote });
  });

  it('ignores an expired remote tombstone for an unknown id and deletes a losing local entry', () => {
    const expired = makeEntry({ deleted: true, updatedAt: isoAt(-91 * DAY_MS) });
    expect(resolveRemoteEntry(undefined, expired, NOW)).toEqual({ type: 'keep' });
    const olderLive = makeEntry({ updatedAt: isoAt(-92 * DAY_MS) });
    expect(resolveRemoteEntry(olderLive, expired, NOW)).toEqual({ type: 'delete' });
  });
});
