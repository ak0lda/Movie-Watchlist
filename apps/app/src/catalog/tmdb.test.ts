import { CatalogError } from '@movie-watchlist/core';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_IMAGE_BASE_URL,
  type TmdbConfig,
} from '../settings/settings';
import { TmdbCatalogProvider, isBearerToken } from './tmdb';
import { posterUrl, toCatalogDetails, yearOf } from './tmdbMapping';

const HEX_KEY = '0123456789abcdef0123456789abcdef';
const BEARER_KEY = 'eyJhbGciOiJIUzI1NiJ9.payload.signature';

function config(overrides: Partial<TmdbConfig> = {}): TmdbConfig {
  return {
    apiKey: HEX_KEY,
    apiBaseUrl: DEFAULT_API_BASE_URL,
    imageBaseUrl: DEFAULT_IMAGE_BASE_URL,
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function setup(response: Response | Error, cfg: TmdbConfig = config()) {
  const fetchImpl = vi.fn<typeof fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response.clone()),
  );
  const provider = new TmdbCatalogProvider({ getConfig: () => cfg, fetchImpl });
  const lastUrl = () => new URL(String(fetchImpl.mock.calls.at(-1)?.[0]));
  const lastInit = () => fetchImpl.mock.calls.at(-1)?.[1];
  return { provider, fetchImpl, lastUrl, lastInit };
}

const searchBody = {
  results: [
    {
      id: 438631,
      media_type: 'movie',
      title: 'Dune',
      original_title: 'Dune',
      release_date: '2021-09-15',
      poster_path: '/d.jpg',
      overview: 'Spice.',
      vote_average: 7.8,
    },
    {
      id: 1399,
      media_type: 'tv',
      name: 'Игра престолов',
      original_name: 'Game of Thrones',
      first_air_date: '2011-04-17',
      poster_path: null,
      vote_average: 0,
    },
    { id: 7, media_type: 'person', name: 'Somebody' },
  ],
};

describe('search', () => {
  it('maps movies and series and drops people', async () => {
    const { provider } = setup(json(searchBody));
    const items = await provider.search('dune', 'en');
    expect(items).toEqual([
      {
        mediaType: 'movie',
        tmdbId: 438631,
        title: 'Dune',
        originalTitle: 'Dune',
        overview: 'Spice.',
        year: 2021,
        posterPath: '/d.jpg',
        tmdbRating: 7.8,
      },
      {
        mediaType: 'tv',
        tmdbId: 1399,
        title: 'Игра престолов',
        originalTitle: 'Game of Thrones',
        overview: '',
        year: 2011,
      },
    ]);
  });

  it('sends the query and the language tag for the UI language', async () => {
    const { provider, lastUrl } = setup(json({ results: [] }));
    await provider.search('игра & престолов', 'ru');
    expect(lastUrl().pathname).toBe('/3/search/multi');
    expect(lastUrl().searchParams.get('query')).toBe('игра & престолов');
    expect(lastUrl().searchParams.get('language')).toBe('ru-RU');
    expect(lastUrl().searchParams.get('include_adult')).toBe('false');
    await provider.search('x', 'en');
    expect(lastUrl().searchParams.get('language')).toBe('en-US');
  });

  it('rejects unsupported languages without a request', async () => {
    const { provider, fetchImpl } = setup(json({}));
    await expect(provider.search('x', 'de')).rejects.toThrow('Unsupported catalog language');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('authentication', () => {
  it('uses the api_key parameter for a v3 key', async () => {
    const { provider, lastUrl, lastInit } = setup(json({ results: [] }));
    await provider.search('x', 'en');
    expect(lastUrl().searchParams.get('api_key')).toBe(HEX_KEY);
    expect(JSON.stringify(lastInit()?.headers)).not.toContain('Authorization');
  });

  it('uses a Bearer header and no api_key for a v4 read access token', async () => {
    const { provider, lastUrl, lastInit } = setup(
      json({ results: [] }),
      config({ apiKey: BEARER_KEY }),
    );
    await provider.search('x', 'en');
    expect(lastUrl().searchParams.has('api_key')).toBe(false);
    expect(lastInit()?.headers).toMatchObject({ Authorization: `Bearer ${BEARER_KEY}` });
  });

  it('detects the token type', () => {
    expect(isBearerToken(BEARER_KEY)).toBe(true);
    expect(isBearerToken(HEX_KEY)).toBe(false);
  });

  it('fails with an auth CatalogError and no request when the key is missing', async () => {
    const { provider, fetchImpl } = setup(json({}), config({ apiKey: '' }));
    await expect(provider.search('x', 'en')).rejects.toMatchObject({ code: 'auth' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('honours a custom API base URL', async () => {
    const { provider, lastUrl } = setup(
      json({ results: [] }),
      config({ apiBaseUrl: 'https://proxy.example/tmdb/3' }),
    );
    await provider.search('x', 'en');
    expect(lastUrl().origin + lastUrl().pathname).toBe('https://proxy.example/tmdb/3/search/multi');
  });
});

describe('getDetails', () => {
  it('requests the movie or tv endpoint and maps genre names', async () => {
    const { provider, lastUrl } = setup(
      json({
        id: 603,
        title: 'The Matrix',
        original_title: 'The Matrix',
        release_date: '1999-03-30',
        genres: [
          { id: 28, name: 'Action' },
          { id: 878, name: 'Science Fiction' },
        ],
        overview: '',
      }),
    );
    const details = await provider.getDetails('movie', 603, 'en');
    expect(lastUrl().pathname).toBe('/3/movie/603');
    expect(details.genres).toEqual(['Action', 'Science Fiction']);
    expect(details).toMatchObject({ mediaType: 'movie', tmdbId: 603, year: 1999 });
  });

  it('uses the tv endpoint for series', async () => {
    const { provider, lastUrl } = setup(json({ id: 1399, name: 'GoT', genres: [] }));
    await provider.getDetails('tv', 1399, 'ru');
    expect(lastUrl().pathname).toBe('/3/tv/1399');
  });
});

describe('errors', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
    [404, 'not-found'],
    [429, 'rate-limited'],
    [500, 'network'],
  ] as const)('maps HTTP %i to CatalogError(%s)', async (status, code) => {
    const { provider } = setup(json({}, status));
    const error = await provider.search('x', 'en').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CatalogError);
    expect((error as CatalogError).code).toBe(code);
  });

  it('maps a network failure to CatalogError(network) and keeps the cause', async () => {
    const cause = new TypeError('Failed to fetch');
    const { provider } = setup(cause);
    const error = await provider.search('x', 'en').catch((e: unknown) => e);
    expect((error as CatalogError).code).toBe('network');
    expect((error as CatalogError).cause).toBe(cause);
  });

  it('maps an unreadable body to CatalogError(network)', async () => {
    const { provider } = setup(new Response('<html>', { status: 200 }));
    await expect(provider.search('x', 'en')).rejects.toMatchObject({ code: 'network' });
  });

  it('rethrows aborts unchanged so callers can ignore them', async () => {
    const abort = new DOMException('Aborted', 'AbortError');
    const { provider } = setup(abort);
    await expect(provider.search('x', 'en')).rejects.toBe(abort);
  });
});

describe('mapping helpers', () => {
  it('extracts the year from TMDB dates', () => {
    expect(yearOf('2021-09-15')).toBe(2021);
    expect(yearOf('')).toBeUndefined();
    expect(yearOf(undefined)).toBeUndefined();
  });

  it('falls back to the title when there is no original title', () => {
    expect(toCatalogDetails({ id: 1, title: 'Only' }, 'movie').originalTitle).toBe('Only');
  });

  it('builds poster URLs from the configured image base', () => {
    expect(posterUrl('https://img.example/t/p', '/a.jpg')).toBe(
      'https://img.example/t/p/w342/a.jpg',
    );
    expect(posterUrl('https://img.example/t/p', undefined)).toBeUndefined();
  });
});
