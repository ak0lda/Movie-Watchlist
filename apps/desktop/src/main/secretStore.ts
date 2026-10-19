import { ConfigError } from '@movie-watchlist/core';
import { readFile, rm } from 'node:fs/promises';
import { isNotFound, writeFileAtomic } from './fsUtil';

/** What SecretStore needs from the OS secret facility (Electron safeStorage in production). */
export interface SecretCrypto {
  isAvailable(): Promise<boolean>;
  encrypt(plain: string): Promise<Uint8Array>;
  /** `shouldReEncrypt` mirrors Electron: the secret should be stored again with fresh keys. */
  decrypt(data: Uint8Array): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

/** Subset of Electron's safeStorage that we rely on. */
export interface SafeStorageLike {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plain: string): Promise<Buffer>;
  decryptStringAsync(data: Buffer): Promise<{ shouldReEncrypt: boolean; result: string }>;
  getSelectedStorageBackend?: () => string;
}

/**
 * Wraps Electron's async safeStorage. On Linux the `basic_text` backend encrypts with a hardcoded
 * password (effectively plaintext) and `unknown` means "not ready", so both count as unavailable.
 */
export function createSafeStorageCrypto(
  safeStorage: SafeStorageLike,
  platform: string = process.platform,
): SecretCrypto {
  return {
    async isAvailable() {
      if (!(await safeStorage.isAsyncEncryptionAvailable())) return false;
      if (platform === 'linux') {
        const backend = safeStorage.getSelectedStorageBackend?.();
        return backend !== undefined && backend !== 'basic_text' && backend !== 'unknown';
      }
      return true;
    },
    encrypt: (plain) => safeStorage.encryptStringAsync(plain),
    decrypt: (data) => safeStorage.decryptStringAsync(Buffer.from(data)),
  };
}

/** The app password, encrypted at rest. It is read only inside the main process. */
export class SecretStore {
  constructor(
    private readonly filePath: string,
    private readonly crypto: SecretCrypto,
  ) {}

  async set(password: string): Promise<void> {
    if (!(await this.crypto.isAvailable())) {
      throw new ConfigError('Secure storage is not available on this system');
    }
    await writeFileAtomic(this.filePath, await this.crypto.encrypt(password));
  }

  /** Null when nothing is stored or the blob cannot be decrypted (other OS user, reset keychain). */
  async get(): Promise<string | null> {
    let blob: Buffer;
    try {
      blob = await readFile(this.filePath);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    if (blob.length === 0) return null;
    try {
      if (!(await this.crypto.isAvailable())) return null;
      const { result, shouldReEncrypt } = await this.crypto.decrypt(blob);
      if (shouldReEncrypt) await this.set(result);
      return result.length > 0 ? result : null;
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}
