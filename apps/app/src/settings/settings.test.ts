import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_IMAGE_BASE_URL,
  EMPTY_SETTINGS,
  SETTINGS_STORAGE_KEY,
  SettingsStore,
  loadSettings,
  normalizeBaseUrl,
  resolveTmdbConfig,
} from './settings';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('normalizeBaseUrl', () => {
  it('accepts https and strips trailing slashes', () => {
    expect(normalizeBaseUrl('https://proxy.example/tmdb/3/')).toBe('https://proxy.example/tmdb/3');
    expect(normalizeBaseUrl('  https://proxy.example  ')).toBe('https://proxy.example');
  });

  it.each([
    'http://proxy.example',
    'ftp://x',
    'proxy.example',
    '',
    'https://x/?q=1',
    'https://x/#frag',
  ])('rejects %j', (value) => {
    expect(normalizeBaseUrl(value)).toBeNull();
  });
});

describe('resolveTmdbConfig', () => {
  it('uses defaults for empty or invalid URLs', () => {
    expect(resolveTmdbConfig(EMPTY_SETTINGS)).toEqual({
      apiKey: '',
      apiBaseUrl: DEFAULT_API_BASE_URL,
      imageBaseUrl: DEFAULT_IMAGE_BASE_URL,
    });
    expect(
      resolveTmdbConfig({ tmdbKey: 'k', apiBaseUrl: 'http://insecure', imageBaseUrl: 'junk' })
        .apiBaseUrl,
    ).toBe(DEFAULT_API_BASE_URL);
  });

  it('prefers the settings key over the .env key', () => {
    expect(resolveTmdbConfig({ ...EMPTY_SETTINGS, tmdbKey: ' mine ' }, 'env').apiKey).toBe('mine');
    expect(resolveTmdbConfig(EMPTY_SETTINGS, ' env ').apiKey).toBe('env');
  });
});

describe('loadSettings', () => {
  it('returns empty settings for missing, corrupt or wrongly typed data', () => {
    expect(loadSettings(memoryStorage())).toEqual(EMPTY_SETTINGS);
    expect(loadSettings(memoryStorage({ [SETTINGS_STORAGE_KEY]: '{oops' }))).toEqual(
      EMPTY_SETTINGS,
    );
    expect(loadSettings(memoryStorage({ [SETTINGS_STORAGE_KEY]: '42' }))).toEqual(EMPTY_SETTINGS);
    expect(
      loadSettings(
        memoryStorage({
          [SETTINGS_STORAGE_KEY]: JSON.stringify({ tmdbKey: 5, apiBaseUrl: 'https://x' }),
        }),
      ),
    ).toEqual({ ...EMPTY_SETTINGS, apiBaseUrl: 'https://x' });
  });
});

describe('SettingsStore', () => {
  it('persists, reloads and notifies subscribers', () => {
    const storage = memoryStorage();
    const store = new SettingsStore(storage);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set({ tmdbKey: 'abc', apiBaseUrl: '', imageBaseUrl: '' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(new SettingsStore(storage).get().tmdbKey).toBe('abc');
    unsubscribe();
    store.set(EMPTY_SETTINGS);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps working in memory when storage throws', () => {
    const store = new SettingsStore({
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(() => store.set({ tmdbKey: 'k', apiBaseUrl: '', imageBaseUrl: '' })).not.toThrow();
    expect(store.get().tmdbKey).toBe('k');
  });
});
