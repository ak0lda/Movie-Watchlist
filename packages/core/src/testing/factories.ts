import { entryId, type MediaType, type MovieEntry } from '../types';

export const NOW = new Date('2026-10-19T12:00:00.000Z');
export const DAY_MS = 24 * 60 * 60 * 1000;

export function isoAt(offsetMs: number, base: Date = NOW): string {
  return new Date(base.getTime() + offsetMs).toISOString();
}

export function makeEntry(
  overrides: Partial<MovieEntry> & { tmdbId?: number; mediaType?: MediaType } = {},
): MovieEntry {
  const mediaType = overrides.mediaType ?? 'movie';
  const tmdbId = overrides.tmdbId ?? 603;
  return {
    id: entryId(mediaType, tmdbId),
    tmdbId,
    mediaType,
    title: 'The Matrix',
    originalTitle: 'The Matrix',
    overview: '',
    genres: [],
    status: 'want',
    addedAt: isoAt(-DAY_MS),
    updatedAt: isoAt(-DAY_MS),
    deleted: false,
    ...overrides,
  };
}
