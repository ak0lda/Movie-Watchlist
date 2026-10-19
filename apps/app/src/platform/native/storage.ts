import {
  ConfigError,
  type StoredSyncConfig,
  type SyncConfigPort,
  type SyncSecretPort,
} from '@movie-watchlist/core';

export const SYNC_CONFIG_STORAGE_KEY = 'movie-watchlist.sync-config';
export const SYNC_PASSWORD_KEY = 'sync-password';

/** Non-secret sync settings in localStorage. Corrupt content means "not configured". */
export class LocalStorageConfigPort implements SyncConfigPort {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'>) {}

  load(): Promise<StoredSyncConfig | null> {
    try {
      const raw = this.storage.getItem(SYNC_CONFIG_STORAGE_KEY);
      if (!raw) return Promise.resolve(null);
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return Promise.resolve(null);
      const { serverUrl, filePath, login } = parsed as Record<string, unknown>;
      if (
        typeof serverUrl !== 'string' ||
        typeof filePath !== 'string' ||
        typeof login !== 'string'
      ) {
        return Promise.resolve(null);
      }
      return Promise.resolve({ serverUrl, filePath, login });
    } catch {
      return Promise.resolve(null);
    }
  }

  save(config: StoredSyncConfig): Promise<void> {
    const { serverUrl, filePath, login } = config;
    this.storage.setItem(SYNC_CONFIG_STORAGE_KEY, JSON.stringify({ serverUrl, filePath, login }));
    return Promise.resolve();
  }
}

/** The part of the secure-storage plugin we use (Android Keystore backed on a device). */
export interface SecureStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** The app password in the platform's secure storage; it is never written anywhere else. */
export class SecureStorageSecretPort implements SyncSecretPort {
  constructor(private readonly storage: SecureStorageLike) {}

  async get(): Promise<string | null> {
    try {
      const value = await this.storage.getItem(SYNC_PASSWORD_KEY);
      return value === null || value === '' ? null : value;
    } catch {
      // Missing key or an entry that cannot be decrypted (restored to another device).
      return null;
    }
  }

  async set(password: string): Promise<void> {
    try {
      await this.storage.setItem(SYNC_PASSWORD_KEY, password);
    } catch (cause) {
      throw new ConfigError('Secure storage is not available', { cause });
    }
  }

  async clear(): Promise<void> {
    try {
      await this.storage.removeItem(SYNC_PASSWORD_KEY);
    } catch {
      // Nothing stored.
    }
  }
}
