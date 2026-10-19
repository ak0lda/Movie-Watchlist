import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import ru from '../locales/ru.json';

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('locale files', () => {
  it('have identical key sets in ru.json and en.json', () => {
    expect(flattenKeys(ru).sort()).toEqual(flattenKeys(en).sort());
  });
});
