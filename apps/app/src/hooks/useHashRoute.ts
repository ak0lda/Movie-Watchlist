import { useSyncExternalStore } from 'react';
import type { MediaType } from '@movie-watchlist/core';

export type Route =
  | { name: 'list' }
  | { name: 'search' }
  | { name: 'title'; mediaType: MediaType; tmdbId: number }
  | { name: 'settings' };

export function parseRoute(hash: string): Route {
  const [, first, second, third] = hash.replace(/^#/, '').split('/');
  if (first === 'search') return { name: 'search' };
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
      return '#/search';
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
