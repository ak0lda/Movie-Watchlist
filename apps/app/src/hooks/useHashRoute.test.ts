import { describe, expect, it } from 'vitest';
import { parseRoute, routeHref, type Route } from './useHashRoute';

describe('parseRoute', () => {
  it.each<[string, Route]>([
    ['', { name: 'list' }],
    ['#/', { name: 'list' }],
    ['#/search', { name: 'search' }],
    ['#/settings', { name: 'settings' }],
    ['#/title/movie/603', { name: 'title', mediaType: 'movie', tmdbId: 603 }],
    ['#/title/tv/1399', { name: 'title', mediaType: 'tv', tmdbId: 1399 }],
  ])('parses %j', (hash, route) => {
    expect(parseRoute(hash)).toEqual(route);
  });

  it.each(['#/title/book/1', '#/title/movie/abc', '#/title/movie/0', '#/title/movie', '#/unknown'])(
    'falls back to the list for %j',
    (hash) => {
      expect(parseRoute(hash)).toEqual({ name: 'list' });
    },
  );

  it('round-trips through routeHref', () => {
    const routes: Route[] = [
      { name: 'list' },
      { name: 'search' },
      { name: 'settings' },
      { name: 'title', mediaType: 'tv', tmdbId: 42 },
    ];
    for (const route of routes) expect(parseRoute(routeHref(route))).toEqual(route);
  });
});
