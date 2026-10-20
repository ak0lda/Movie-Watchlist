export const SETTINGS_STORAGE_KEY = 'movie-watchlist.settings';

export const DEFAULT_API_BASE_URL = 'https://api.themoviedb.org/3';
export const DEFAULT_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p';

/** Stored locally. The TMDB key is public in any client bundle, so it is not treated as a secret. */
export interface Settings {
  tmdbKey: string;
  /** Empty means the default. */
  apiBaseUrl: string;
  imageBaseUrl: string;
  /** Optional key of the unofficial Kinopoisk API (turns a shared Kinopoisk link into a title). */
  kinopoiskKey: string;
}

export const EMPTY_SETTINGS: Settings = {
  tmdbKey: '',
  apiBaseUrl: '',
  imageBaseUrl: '',
  kinopoiskKey: '',
};

export interface TmdbConfig {
  apiKey: string;
  apiBaseUrl: string;
  imageBaseUrl: string;
}

/** Only https, no trailing slash. Returns null for anything else. */
export function normalizeBaseUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.search || url.hash) return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** Empty fields fall back to the defaults; a non-empty invalid URL also falls back. */
export function resolveTmdbConfig(settings: Settings, envKey = ''): TmdbConfig {
  return {
    apiKey: settings.tmdbKey.trim() || envKey.trim(),
    apiBaseUrl: normalizeBaseUrl(settings.apiBaseUrl) ?? DEFAULT_API_BASE_URL,
    imageBaseUrl: normalizeBaseUrl(settings.imageBaseUrl) ?? DEFAULT_IMAGE_BASE_URL,
  };
}

export function loadSettings(storage: Pick<Storage, 'getItem'>): Settings {
  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return EMPTY_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_SETTINGS;
    const record = parsed as Record<string, unknown>;
    const text = (key: keyof Settings) => (typeof record[key] === 'string' ? record[key] : '');
    return {
      tmdbKey: text('tmdbKey'),
      apiBaseUrl: text('apiBaseUrl'),
      imageBaseUrl: text('imageBaseUrl'),
      kinopoiskKey: text('kinopoiskKey'),
    };
  } catch {
    return EMPTY_SETTINGS;
  }
}

type Listener = () => void;

/** Tiny observable store so screens and the TMDB provider read the same live settings. */
export class SettingsStore {
  private value: Settings;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    this.value = storage ? loadSettings(storage) : EMPTY_SETTINGS;
  }

  get = (): Settings => this.value;

  set(next: Settings): void {
    this.value = next;
    try {
      this.storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable: keep the in-memory value for this session.
    }
    this.listeners.forEach((listener) => listener());
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}
