import type { HttpTransport } from '@movie-watchlist/core';

export const KINOPOISK_API_BASE_URL = 'https://kinopoiskapiunofficial.tech';
const MAX_ID = 999_999_999;
const MAX_TITLE_LENGTH = 200;

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s"'<>]+/giu;
const FILM_PATH = /\/(?:film|series)\/(\d{1,9})(?:\/|$)/u;

/**
 * The Kinopoisk film/series number from the first Kinopoisk link found in the given texts, e.g.
 * `https://www.kinopoisk.ru/film/535341/?socialAlias=...` -> 535341. Links with a hash instead of a
 * number (hd.kinopoisk.ru), persons, lists and other sites are ignored.
 */
export function extractKinopoiskId(texts: readonly string[]): number | null {
  for (const text of texts) {
    for (const match of text.slice(0, 5000).matchAll(URL_PATTERN)) {
      const raw = match[0].startsWith('www.') ? `https://${match[0]}` : match[0];
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        continue;
      }
      const host = url.hostname.toLowerCase();
      if (host !== 'kinopoisk.ru' && !host.endsWith('.kinopoisk.ru')) continue;
      const id = Number(FILM_PATH.exec(url.pathname)?.[1]);
      if (Number.isInteger(id) && id > 0 && id <= MAX_ID) return id;
    }
  }
  return null;
}

export type KinopoiskErrorCode = 'no-key' | 'auth' | 'not-found' | 'rate-limited' | 'network';

/** Failure of a title lookup; the message never contains the API key. */
export class KinopoiskError extends Error {
  readonly code: KinopoiskErrorCode;

  constructor(code: KinopoiskErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'KinopoiskError';
    this.code = code;
  }
}

/** Turns a Kinopoisk number into a title to search for (the unofficial API needs the user's key). */
export interface KinopoiskResolver {
  /** @param language UI language: Russian prefers the Russian title, others the English one. */
  resolve(id: number, language: string): Promise<string>;
}

export interface KinopoiskResolverOptions {
  /** Platform HTTP transport (the native one on Android, so CORS does not apply). */
  transport: HttpTransport;
  getKey: () => string;
  baseUrl?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function textField(record: Record<string, unknown>, name: string): string | undefined {
  const value = record[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Pulls the title to search for out of the API answer. Both known shapes are accepted: the fields
 * directly on the object, or wrapped in `data` (older versions of the service).
 *
 * The original title comes first: TMDB indexes it, and it is far more distinctive than a localised
 * one ("Intouchables" finds the film, "1+1" returns unrelated series). Then the UI language's own
 * title, then the other one.
 */
export function pickTitle(payload: unknown, language: string): string | undefined {
  if (!isRecord(payload)) return undefined;
  const film = isRecord(payload['data']) ? payload['data'] : payload;
  const ru = textField(film, 'nameRu');
  const en = textField(film, 'nameEn');
  const original = textField(film, 'nameOriginal');
  const ordered = language === 'ru' ? [original, ru, en] : [original, en, ru];
  return ordered.find((name) => name !== undefined)?.slice(0, MAX_TITLE_LENGTH);
}

export function createKinopoiskResolver(options: KinopoiskResolverOptions): KinopoiskResolver {
  const baseUrl = (options.baseUrl ?? KINOPOISK_API_BASE_URL).replace(/\/+$/, '');

  return {
    async resolve(id, language) {
      const key = options.getKey().trim();
      if (key === '') throw new KinopoiskError('no-key', 'Kinopoisk API key is not set');
      if (!Number.isInteger(id) || id <= 0 || id > MAX_ID) {
        throw new KinopoiskError('not-found', 'Invalid Kinopoisk id');
      }

      let response: Awaited<ReturnType<HttpTransport['request']>>;
      try {
        response = await options.transport.request({
          method: 'GET',
          url: `${baseUrl}/api/v2.2/films/${id}`,
          headers: { 'X-API-KEY': key, Accept: 'application/json' },
        });
      } catch (cause) {
        throw new KinopoiskError('network', 'Kinopoisk request failed', { cause });
      }

      switch (response.status) {
        case 200:
          break;
        case 401:
        case 403:
          throw new KinopoiskError('auth', 'Kinopoisk rejected the API key');
        case 404:
          throw new KinopoiskError('not-found', 'Title not found on Kinopoisk');
        case 402: // daily quota used up
        case 429:
          throw new KinopoiskError('rate-limited', 'Kinopoisk request limit reached');
        default:
          throw new KinopoiskError('network', `Kinopoisk answered HTTP ${response.status}`);
      }

      let payload: unknown;
      try {
        payload = JSON.parse(response.body);
      } catch (cause) {
        throw new KinopoiskError('network', 'Kinopoisk returned an unreadable answer', { cause });
      }
      const title = pickTitle(payload, language);
      if (!title) throw new KinopoiskError('not-found', 'Kinopoisk has no title for this id');
      return title;
    },
  };
}
