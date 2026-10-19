import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import ru from '../locales/ru.json';
import { LANGUAGE_STORAGE_KEY, resolveLanguage, type Language } from './resolveLanguage';

function readStoredLanguage(): string | null {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

void i18n.use(initReactI18next).init({
  resources: { ru: { translation: ru }, en: { translation: en } },
  lng: resolveLanguage(readStoredLanguage(), navigator.languages),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// Keep <html lang> in sync for screen readers and hyphenation.
document.documentElement.lang = i18n.language;
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

/** Switches the UI language and remembers the choice locally. */
export async function setLanguage(language: Language): Promise<void> {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
  await i18n.changeLanguage(language);
}

export default i18n;
