import type { MovieEntry } from '@movie-watchlist/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIST_QUERY, applyListQuery } from './listView';

function e(id: number, overrides: Partial<MovieEntry> = {}): MovieEntry {
  return {
    id: `movie:${id}`,
    tmdbId: id,
    mediaType: 'movie',
    title: `Title ${id}`,
    originalTitle: `Original ${id}`,
    overview: '',
    genres: [],
    status: 'want',
    addedAt: `2026-01-0${id}T00:00:00.000Z`,
    updatedAt: `2026-01-0${id}T00:00:00.000Z`,
    deleted: false,
    ...overrides,
  };
}

const ids = (entries: MovieEntry[]) => entries.map((x) => x.tmdbId);

describe('applyListQuery', () => {
  it('hides tombstones', () => {
    expect(ids(applyListQuery([e(1), e(2, { deleted: true })], DEFAULT_LIST_QUERY))).toEqual([1]);
  });

  it('filters by status', () => {
    const entries = [
      e(1, { status: 'want' }),
      e(2, { status: 'watching' }),
      e(3, { status: 'watched' }),
    ];
    expect(ids(applyListQuery(entries, { ...DEFAULT_LIST_QUERY, status: 'watching' }))).toEqual([
      2,
    ]);
    expect(ids(applyListQuery(entries, { ...DEFAULT_LIST_QUERY, status: 'all' }))).toHaveLength(3);
  });

  it('searches title, original title, source and note, case-insensitively', () => {
    const entries = [
      e(1, { title: 'Дюна', originalTitle: 'Dune' }),
      e(2, { source: 'друг Вася' }),
      e(3, { note: 'Посмотреть ВМЕСТЕ' }),
      e(4),
    ];
    const search = (needle: string) =>
      ids(applyListQuery(entries, { ...DEFAULT_LIST_QUERY, search: needle }));
    expect(search('dune')).toEqual([1]);
    expect(search('ДЮНА')).toEqual([1]);
    expect(search('вася')).toEqual([2]);
    expect(search('вместе')).toEqual([3]);
    expect(search('  ')).toHaveLength(4);
    expect(search('nothing')).toEqual([]);
  });

  it('sorts by date added, newest first by default', () => {
    expect(ids(applyListQuery([e(1), e(3), e(2)], DEFAULT_LIST_QUERY))).toEqual([3, 2, 1]);
  });

  it('sorts by title using the given locale', () => {
    const entries = [e(1, { title: 'Яблоко' }), e(2, { title: 'Арбуз' }), e(3, { title: 'Банан' })];
    expect(ids(applyListQuery(entries, { ...DEFAULT_LIST_QUERY, sort: 'title' }, 'ru'))).toEqual([
      2, 3, 1,
    ]);
  });

  it('sorts by rating, highest first, unrated last, ties by title', () => {
    const entries = [
      e(1, { rating: 5, title: 'B' }),
      e(2, { title: 'A' }),
      e(3, { rating: 9, title: 'C' }),
      e(4, { rating: 5, title: 'A' }),
    ];
    expect(ids(applyListQuery(entries, { ...DEFAULT_LIST_QUERY, sort: 'rating' }))).toEqual([
      3, 4, 1, 2,
    ]);
  });

  it('does not mutate the input array', () => {
    const entries = [e(1), e(2)];
    applyListQuery(entries, DEFAULT_LIST_QUERY);
    expect(ids(entries)).toEqual([1, 2]);
  });
});
