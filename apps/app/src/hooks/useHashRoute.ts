import { useSyncExternalStore } from 'react';
import type { MediaType } from '@movie-watchlist/core';

export type Route =
  | { name: 'list' }
  /** `query` prefills the search box (e.g. from Android Share); `notFound` means a share had no title. */
  | { name: 'search'; query?: string; notFound?: boolean; received?: string; kinopoiskId?: number }
  | { name: 'title'; mediaType: MediaType; tmdbId: number }
  | { name: 'settings' };

const MAX_ROUTE_QUERY_LENGTH = 200;

export function parseRoute(hash: string): Route {
  const body = hash.replace(/^#/, '');
  const queryAt = body.indexOf('?');
  const path = queryAt === -1 ? body : body.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? '' : body.slice(queryAt + 1));
  const [, first, second, third] = path.split('/');
  if (first === 'search') {
    const query = params.get('q')?.trim().slice(0, MAX_ROUTE_QUERY_LENGTH);
    const kp = Number(params.get('kp'));
    const kinopoiskId = Number.isInteger(kp) && kp > 0 && kp <= 999_999_999 ? kp : undefined;
    return {
      name: 'search',
      ...(query ? { query } : {}),
      ...(!query && kinopoiskId !== undefined
        ? {
            kinopoiskId,
            ...(params.get('got')
              ? { received: params.get('got')!.slice(0, MAX_ROUTE_QUERY_LENGTH * 2) }
              : {}),
          }
        : {}),
      ...(!query && kinopoiskId === undefined && params.get('notFound') === '1'
        ? {
            notFound: true,
            ...(params.get('got')
              ? { received: params.get('got')!.slice(0, MAX_ROUTE_QUERY_LENGTH * 2) }
              : {}),
          }
        : {}),
    };
  }
  if (first === 'settings') return { name: 'settings' };
  if (first === 'title' && (second === 'movie' || second === 'tv')) {
    const tmdbId = Number(third);
    if (Number.isInteger(tmdbId) && tmdbId > 0) return { name: 'title', mediaType: second, tmdbId };
  }
  return { name: 'list' };
}

export function routeHref(route: Route): string {
  switch (route.name) {
    case 'list':
      return '#/';
    case 'search':
      if (route.query) return `#/search?q=${encodeURIComponent(route.query)}`;
      if (route.kinopoiskId !== undefined) {
        const base = `#/search?kp=${route.kinopoiskId}`;
        return route.received ? `${base}&got=${encodeURIComponent(route.received)}` : base;
      }
      if (!route.notFound) return '#/search';
      return route.received
        ? `#/search?notFound=1&got=${encodeURIComponent(route.received)}`
        : '#/search?notFound=1';
    case 'settings':
      return '#/settings';
    case 'title':
      return `#/title/${route.mediaType}/${route.tmdbId}`;
  }
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

const getHash = (): string => window.location.hash;

/** Returns the raw hash (stable string snapshot) and derives the route from it. */
export function useHashRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, getHash));
}
