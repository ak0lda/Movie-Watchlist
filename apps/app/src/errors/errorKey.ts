import { CatalogError, SchemaError, SyncError } from '@movie-watchlist/core';

/** Maps typed errors to translation keys; the UI never shows raw error messages. */
export function errorKey(error: unknown): string {
  if (error instanceof CatalogError) {
    switch (error.code) {
      case 'auth':
        return 'errors.catalog.auth';
      case 'not-found':
        return 'errors.catalog.notFound';
      case 'rate-limited':
        return 'errors.catalog.rateLimited';
      case 'network':
        return 'errors.catalog.network';
    }
  }
  if (error instanceof SchemaError) {
    return error.reason === 'newer-version'
      ? 'errors.schema.newerVersion'
      : 'errors.schema.invalid';
  }
  if (error instanceof SyncError) {
    switch (error.code) {
      case 'network':
        return 'errors.sync.network';
      case 'auth':
        return 'errors.sync.auth';
      case 'conflict':
        return 'errors.sync.conflict';
      case 'storage':
        return 'errors.sync.storage';
      case 'schema':
        return 'errors.schema.invalid';
    }
  }
  return 'errors.unknown';
}
