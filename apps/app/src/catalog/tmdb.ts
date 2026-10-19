import {
  CatalogError,
  type AbortSignalLike,
  type CatalogDetails,
  type CatalogItem,
  type CatalogProvider,
  type MediaType,
} from '@movie-watchlist/core';
import type { TmdbConfig } from '../settings/settings';
import { toCatalogDetails, toCatalogItem, type TmdbTitle } from './tmdbMapping';

const LANGUAGE_TAGS: Record<string, string> = { ru: 'ru-RU', en: 'en-US' };

/** A v4 "API Read Access Token" is a JWT; a v3 "API Key" is 32 hex characters. */
export function isBearerToken(key: string): boolean {
  return key.startsWith('eyJ');
}

export interface TmdbProviderOptions {
  getConfig: () => TmdbConfig;
  fetchImpl?: typeof fetch;
}

export class TmdbCatalogProvider implements CatalogProvider {
  readonly supportedLanguages = Object.keys(LANGUAGE_TAGS);
  private readonly getConfig: () => TmdbConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TmdbProviderOptions) {
    this.getConfig = options.getConfig;
    // Bound: calling a detached window.fetch throws "Illegal invocation".
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  }

  async search(query: string, language: string, signal?: AbortSignalLike): Promise<CatalogItem[]> {
    const data = await this.request<{ results?: TmdbTitle[] }>(
      '/search/multi',
      { query, include_adult: 'false', page: '1' },
      language,
      signal,
    );
    const items: CatalogItem[] = [];
    for (const raw of data.results ?? []) {
      if (raw.media_type === 'movie' || raw.media_type === 'tv') {
        items.push(toCatalogItem(raw, raw.media_type));
      }
    }
    return items;
  }

  async getDetails(
    mediaType: MediaType,
    tmdbId: number,
    language: string,
    signal?: AbortSignalLike,
  ): Promise<CatalogDetails> {
    const raw = await this.request<TmdbTitle>(`/${mediaType}/${tmdbId}`, {}, language, signal);
    return toCatalogDetails(raw, mediaType);
  }

  private async request<T>(
    path: string,
    params: Record<string, string>,
    language: string,
    signal?: AbortSignalLike,
  ): Promise<T> {
    const tag = LANGUAGE_TAGS[language];
    if (!tag) throw new Error(`Unsupported catalog language: ${language}`);
    const config = this.getConfig();
    if (!config.apiKey) throw new CatalogError('auth', 'TMDB API key is not configured');

    const url = new URL(config.apiBaseUrl + path);
    for (const [key, value] of Object.entries({ ...params, language: tag })) {
      url.searchParams.set(key, value);
    }
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (isBearerToken(config.apiKey)) headers['Authorization'] = `Bearer ${config.apiKey}`;
    else url.searchParams.set('api_key', config.apiKey);

    let response: Response;
    try {
      const init: RequestInit = { headers };
      // The AbortSignal subset in core is structurally the DOM signal.
      if (signal) init.signal = signal as AbortSignal;
      response = await this.fetchImpl(url, init);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      throw new CatalogError('network', 'TMDB request failed', { cause });
    }
    if (response.status === 401 || response.status === 403) {
      throw new CatalogError('auth', 'TMDB rejected the API key');
    }
    if (response.status === 404) throw new CatalogError('not-found', 'TMDB title not found');
    if (response.status === 429) throw new CatalogError('rate-limited', 'TMDB rate limit hit');
    if (!response.ok) throw new CatalogError('network', `TMDB responded with ${response.status}`);
    try {
      return (await response.json()) as T;
    } catch (cause) {
      throw new CatalogError('network', 'TMDB returned an unreadable response', { cause });
    }
  }
}
