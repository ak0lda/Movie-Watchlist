import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalize } from './canonical';
import { dedupeById, merge, mergeEntry } from './merge';
import { DAY_MS, NOW, isoAt, makeEntry } from './testing/factories';
import { MemoryLocalStore } from './testing/memoryLocalStore';
import type { MovieEntry } from './types';

// Few ids and few timestamps on purpose: collisions and exact ties are the interesting cases.
const offsets = [-200 * DAY_MS, -95 * DAY_MS, -90 * DAY_MS, -10 * DAY_MS, -1000, 0, 1000];

const entryArb: fc.Arbitrary<MovieEntry> = fc
  .record({
    mediaType: fc.constantFrom('movie' as const, 'tv' as const),
    tmdbId: fc.integer({ min: 1, max: 3 }),
    updatedAtOffset: fc.constantFrom(...offsets),
    status: fc.constantFrom('want' as const, 'watching' as const, 'watched' as const),
    deleted: fc.boolean(),
    note: fc.option(fc.constantFrom('a', 'b', 'c'), { nil: undefined }),
  })
  .map(({ updatedAtOffset, note, ...rest }) =>
    makeEntry({
      ...rest,
      updatedAt: isoAt(updatedAtOffset),
      ...(note === undefined ? {} : { note }),
    }),
  );

const listArb = fc.array(entryArb, { maxLength: 8 });

describe('merge properties', () => {
  it('is commutative', () => {
    fc.assert(
      fc.property(listArb, listArb, (a, b) => {
        expect(merge(a, b, NOW)).toEqual(merge(b, a, NOW));
      }),
    );
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(listArb, listArb, (a, b) => {
        const once = merge(a, b, NOW);
        expect(merge(once, once, NOW)).toEqual(once);
        expect(merge(once, [], NOW)).toEqual(once);
        expect(merge(a, a, NOW)).toEqual(merge(a, [], NOW));
      }),
    );
  });

  it('does not depend on element order within a list', () => {
    fc.assert(
      fc.property(listArb, (a) => {
        expect(merge([...a].reverse(), [], NOW)).toEqual(merge(a, [], NOW));
      }),
    );
  });

  it('tie-break is deterministic: equal updatedAt picks the greater canonical form in both orders', () => {
    fc.assert(
      fc.property(entryArb, entryArb, (a, y) => {
        const b = {
          ...y,
          id: a.id,
          tmdbId: a.tmdbId,
          mediaType: a.mediaType,
          updatedAt: a.updatedAt,
        };
        const winner = canonicalize(a) >= canonicalize(b) ? a : b;
        expect(canonicalize(mergeEntry(a, b))).toBe(canonicalize(winner));
        expect(canonicalize(mergeEntry(b, a))).toBe(canonicalize(winner));
      }),
    );
  });

  it('the winner always has the maximal updatedAt for its id', () => {
    fc.assert(
      fc.property(listArb, listArb, (a, b) => {
        for (const merged of merge(a, b, NOW)) {
          const max = Math.max(
            ...[...a, ...b].filter((e) => e.id === merged.id).map((e) => Date.parse(e.updatedAt)),
          );
          expect(Date.parse(merged.updatedAt)).toBe(max);
        }
      }),
    );
  });

  it('applying remote entries one by one equals the pure merge (the store rule)', async () => {
    await fc.assert(
      fc.asyncProperty(listArb, listArb, async (local, remote) => {
        // Deduplicated local list without GC (relative to the epoch nothing is expired).
        const seed = merge(local, [], new Date(0));
        const store = new MemoryLocalStore(seed);
        // Remote files reach the store through parseSyncFile, which guarantees unique ids.
        await store.applyRemote(dedupeById(remote), NOW);
        expect(await store.getAll()).toEqual(merge(seed, remote, NOW));
      }),
    );
  });
});
