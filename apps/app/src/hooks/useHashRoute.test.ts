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

  it('carries what a share contained when no title was found', () => {
    const href = routeHref({
      name: 'search',
      notFound: true,
      received: 'https://x.example/?a=1&b=2',
    });
    expect(parseRoute(href)).toEqual({
      name: 'search',
      notFound: true,
      received: 'https://x.example/?a=1&b=2',
    });
    expect(parseRoute('#/search?notFound=1&got=')).toEqual({ name: 'search', notFound: true });
    // Ignored without the marker, and capped in length.
    expect(parseRoute('#/search?got=abc')).toEqual({ name: 'search' });
    const long = parseRoute(`#/search?notFound=1&got=${'a'.repeat(5000)}`) as { received: string };
    expect(long.received.length).toBeLessThanOrEqual(400);
  });

  it('carries a Kinopoisk number to look up', () => {
    expect(parseRoute('#/search?kp=535341')).toEqual({ name: 'search', kinopoiskId: 535341 });
    expect(parseRoute('#/search?kp=535341&got=abc')).toEqual({
      name: 'search',
      kinopoiskId: 535341,
      received: 'abc',
    });
    const href = routeHref({
      name: 'search',
      kinopoiskId: 7,
      received: 'https://x.example/?a=1&b=2',
    });
    expect(parseRoute(href)).toEqual({
      name: 'search',
      kinopoiskId: 7,
      received: 'https://x.example/?a=1&b=2',
    });
    expect(routeHref({ name: 'search', kinopoiskId: 7 })).toBe('#/search?kp=7');
  });

  it.each([
    '#/search?kp=0',
    '#/search?kp=-5',
    '#/search?kp=abc',
    '#/search?kp=1.5',
    '#/search?kp=1000000000',
    '#/search?kp=',
  ])('ignores the invalid kp value in %j', (hash) => {
    expect(parseRoute(hash)).toEqual({ name: 'search' });
  });

  it('a text query wins over a Kinopoisk lookup, which wins over the not-found marker', () => {
    expect(parseRoute('#/search?q=Dune&kp=5')).toEqual({ name: 'search', query: 'Dune' });
    expect(parseRoute('#/search?kp=5&notFound=1')).toEqual({ name: 'search', kinopoiskId: 5 });
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
