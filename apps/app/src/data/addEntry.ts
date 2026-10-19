import type { CatalogItem, CatalogProvider, MovieEntry } from '@movie-watchlist/core';
import type { MetaCache } from './metaCache';
import type { EntryRepository } from './repository';

/**
 * Adds a title to the list. Genres come from the TMDB details in the current language (cache first);
 * if those are unreachable the entry is still created with an empty genre list, never refused.
 */
export async function addTitle(
  deps: { repo: EntryRepository; catalog: CatalogProvider; metaCache: MetaCache },
  item: CatalogItem,
  lang: string,
): Promise<MovieEntry> {
  let genres: string[] = [];
  try {
    const cached = await deps.metaCache.get(item.mediaType, item.tmdbId, lang);
    if (cached) {
      genres = cached.details.genres;
    } else {
      const details = await deps.catalog.getDetails(item.mediaType, item.tmdbId, lang);
      await deps.metaCache.put(details, lang);
      genres = details.genres;
    }
  } catch {
    // Offline or no API key: fall back to the data we already have.
  }
  return deps.repo.add(item, genres);
}
