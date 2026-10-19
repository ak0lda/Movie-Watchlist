import type { CatalogDetails, CatalogItem, MediaType } from '@movie-watchlist/core';

/** Subset of TMDB fields we read; everything is optional because TMDB omits freely. */
export interface TmdbTitle {
  id: number;
  media_type?: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  overview?: string;
  vote_average?: number;
  genres?: { id: number; name: string }[];
}

export function yearOf(date: string | undefined): number | undefined {
  const match = /^(\d{4})-/.exec(date ?? '');
  return match?.[1] ? Number(match[1]) : undefined;
}

export function toCatalogItem(raw: TmdbTitle, mediaType: MediaType): CatalogItem {
  const title = (mediaType === 'movie' ? raw.title : raw.name) ?? '';
  const originalTitle = (mediaType === 'movie' ? raw.original_title : raw.original_name) ?? title;
  const year = yearOf(mediaType === 'movie' ? raw.release_date : raw.first_air_date);
  const item: CatalogItem = {
    mediaType,
    tmdbId: raw.id,
    title,
    originalTitle,
    overview: raw.overview ?? '',
  };
  if (year !== undefined) item.year = year;
  if (raw.poster_path) item.posterPath = raw.poster_path;
  // TMDB reports 0 for "no votes".
  if (raw.vote_average) item.tmdbRating = raw.vote_average;
  return item;
}

export function toCatalogDetails(raw: TmdbTitle, mediaType: MediaType): CatalogDetails {
  return {
    ...toCatalogItem(raw, mediaType),
    genres: (raw.genres ?? []).map((genre) => genre.name),
  };
}

export function posterUrl(
  imageBaseUrl: string,
  posterPath: string | undefined,
  size = 'w342',
): string | undefined {
  return posterPath ? `${imageBaseUrl}/${size}${posterPath}` : undefined;
}
