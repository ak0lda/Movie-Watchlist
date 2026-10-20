import {
  AuthError,
  CatalogError,
  ConfigError,
  ConflictError,
  NetworkError,
  SchemaError,
  StorageError,
} from '@movie-watchlist/core';
import { describe, expect, it } from 'vitest';
import en from '../locales/en.json';
import ru from '../locales/ru.json';
import { KinopoiskError } from '../share/kinopoisk';
import { errorKey } from './errorKey';

function lookup(tree: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree);
}

const CASES: [string, unknown, string][] = [
  ['catalog auth', new CatalogError('auth', ''), 'errors.catalog.auth'],
  ['catalog not-found', new CatalogError('not-found', ''), 'errors.catalog.notFound'],
  ['catalog rate-limited', new CatalogError('rate-limited', ''), 'errors.catalog.rateLimited'],
  ['catalog network', new CatalogError('network', ''), 'errors.catalog.network'],
  ['newer schema', new SchemaError('newer-version', ''), 'errors.schema.newerVersion'],
  ['invalid schema', new SchemaError('invalid', ''), 'errors.schema.invalid'],
  ['sync network', new NetworkError(), 'errors.sync.network'],
  ['sync auth', new AuthError(), 'errors.sync.auth'],
  ['sync conflict', new ConflictError(), 'errors.sync.conflict'],
  ['sync storage', new StorageError(), 'errors.sync.storage'],
  ['sync config', new ConfigError(), 'errors.sync.config'],
  ['kinopoisk no key', new KinopoiskError('no-key', ''), 'errors.kinopoisk.noKey'],
  ['kinopoisk auth', new KinopoiskError('auth', ''), 'errors.kinopoisk.auth'],
  ['kinopoisk not found', new KinopoiskError('not-found', ''), 'errors.kinopoisk.notFound'],
  [
    'kinopoisk rate limited',
    new KinopoiskError('rate-limited', ''),
    'errors.kinopoisk.rateLimited',
  ],
  ['kinopoisk network', new KinopoiskError('network', ''), 'errors.kinopoisk.network'],
  ['plain error', new Error('boom'), 'errors.unknown'],
  ['non-error', 'boom', 'errors.unknown'],
];

describe('errorKey', () => {
  it.each(CASES)('maps %s', (_name, error, key) => {
    expect(errorKey(error)).toBe(key);
  });

  it.each(CASES)('has translations in both languages for %s', (_name, error) => {
    const key = errorKey(error);
    expect(typeof lookup(en, key)).toBe('string');
    expect(typeof lookup(ru, key)).toBe('string');
  });
});
