export const SUPPORTED_LANGUAGES = ['ru', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'movie-watchlist.lang';

function isLanguage(value: string | null): value is Language {
  return SUPPORTED_LANGUAGES.some((lang) => lang === value);
}

/** Saved choice wins; otherwise `ru` if the system locale is Russian, else `en`. */
export function resolveLanguage(stored: string | null, systemLocales: readonly string[]): Language {
  if (isLanguage(stored)) return stored;
  const primary = systemLocales[0]?.toLowerCase() ?? '';
  return primary === 'ru' || primary.startsWith('ru-') ? 'ru' : 'en';
}
