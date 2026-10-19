import type { MovieEntry, WatchStatus } from '@movie-watchlist/core';

export type SortKey = 'addedAt' | 'title' | 'rating';
export type StatusFilter = WatchStatus | 'all';

export interface ListQuery {
  status: StatusFilter;
  search: string;
  sort: SortKey;
}

export const DEFAULT_LIST_QUERY: ListQuery = { status: 'all', search: '', sort: 'addedAt' };

function matchesSearch(entry: MovieEntry, needle: string): boolean {
  return [entry.title, entry.originalTitle, entry.source, entry.note].some((field) =>
    field?.toLowerCase().includes(needle),
  );
}

/** Tombstones are hidden. Sorts: newest added first, title A-Z, rating high-first (unrated last). */
export function applyListQuery(
  entries: readonly MovieEntry[],
  query: ListQuery,
  locale?: string,
): MovieEntry[] {
  const needle = query.search.trim().toLowerCase();
  const visible = entries.filter(
    (entry) =>
      !entry.deleted &&
      (query.status === 'all' || entry.status === query.status) &&
      (needle === '' || matchesSearch(entry, needle)),
  );
  const byTitle = (a: MovieEntry, b: MovieEntry) => a.title.localeCompare(b.title, locale);

  switch (query.sort) {
    case 'title':
      return visible.sort(byTitle);
    case 'rating':
      return visible.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || byTitle(a, b));
    case 'addedAt':
      return visible.sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt) || byTitle(a, b));
  }
}
