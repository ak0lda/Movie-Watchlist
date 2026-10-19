import { describe, expect, it } from 'vitest';
import { resolveLanguage } from './resolveLanguage';

describe('resolveLanguage', () => {
  it('prefers a valid stored choice over the system locale', () => {
    expect(resolveLanguage('en', ['ru-RU'])).toBe('en');
    expect(resolveLanguage('ru', ['en-US'])).toBe('ru');
  });

  it('ignores an unsupported stored value', () => {
    expect(resolveLanguage('de', ['ru'])).toBe('ru');
    expect(resolveLanguage('', ['fr'])).toBe('en');
  });

  it('uses ru for Russian system locales and en otherwise', () => {
    expect(resolveLanguage(null, ['ru'])).toBe('ru');
    expect(resolveLanguage(null, ['ru-RU', 'en-US'])).toBe('ru');
    expect(resolveLanguage(null, ['en-US', 'ru'])).toBe('en');
    expect(resolveLanguage(null, ['uk-UA'])).toBe('en');
    expect(resolveLanguage(null, [])).toBe('en');
  });
});
