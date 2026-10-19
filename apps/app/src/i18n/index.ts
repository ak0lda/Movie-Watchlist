import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import ru from '../locales/ru.json';
import { LANGUAGE_STORAGE_KEY, resolveLanguage } from './resolveLanguage';

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

export default i18n;
