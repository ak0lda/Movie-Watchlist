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

describe('search route with a query', () => {
  it('parses a plain and a percent-encoded query', () => {
    expect(parseRoute('#/search?q=Dune')).toEqual({ name: 'search', query: 'Dune' });
    expect(parseRoute('#/search?q=%D0%94%D1%8E%D0%BD%D0%B0')).toEqual({
      name: 'search',
      query: 'Дюна',
    });
  });

  it.each([
    'Дюна: Часть вторая',
    'a&b=c',
    '100% match',
    '#hash',
    'a/b?c',
    'plus + sign',
    '🎬 emoji',
    'quote "x" \'y\'',
    '/title/movie/1',
  ])('round-trips %j through routeHref', (query) => {
    expect(parseRoute(routeHref({ name: 'search', query }))).toEqual({ name: 'search', query });
  });

  it('trims the query and treats an empty one as no query', () => {
    expect(parseRoute('#/search?q=%20%20Dune%20')).toEqual({ name: 'search', query: 'Dune' });
    expect(parseRoute('#/search?q=')).toEqual({ name: 'search' });
    expect(parseRoute('#/search?q=%20')).toEqual({ name: 'search' });
    expect(parseRoute('#/search')).toEqual({ name: 'search' });
  });

  it('caps an absurdly long query', () => {
    const route = parseRoute(`#/search?q=${'a'.repeat(5000)}`);
    expect(route).toMatchObject({ name: 'search' });
    expect((route as { query: string }).query).toHaveLength(200);
  });

  it('survives malformed percent sequences', () => {
    expect(() => parseRoute('#/search?q=%E0%A4%A')).not.toThrow();
    expect(parseRoute('#/search?q=%')).toMatchObject({ name: 'search' });
  });

  it('knows the "nothing found in the share" marker', () => {
    expect(parseRoute('#/search?notFound=1')).toEqual({ name: 'search', notFound: true });
    expect(routeHref({ name: 'search', notFound: true })).toBe('#/search?notFound=1');
    // A real query wins over the marker.
    expect(parseRoute('#/search?q=Dune&notFound=1')).toEqual({ name: 'search', query: 'Dune' });
  });

  it('builds hrefs', () => {
    expect(routeHref({ name: 'search' })).toBe('#/search');
    expect(routeHref({ name: 'search', query: 'Дюна' })).toBe(
      '#/search?q=%D0%94%D1%8E%D0%BD%D0%B0',
    );
  });

  it('ignores a query string on other routes', () => {
    expect(parseRoute('#/settings?x=1')).toEqual({ name: 'settings' });
    expect(parseRoute('#/title/movie/603?x=1')).toEqual({
      name: 'title',
      mediaType: 'movie',
      tmdbId: 603,
    });
    expect(parseRoute('#/?q=x')).toEqual({ name: 'list' });
  });
});
