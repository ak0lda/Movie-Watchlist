import { ConfigError, parseWebDavTarget, type SyncConfigInput } from '@movie-watchlist/core';
import { originKey } from '../shared/origin';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_URL_LENGTH = 2048;
const MAX_LOGIN_LENGTH = 256;
const MAX_PASSWORD_LENGTH = 1024;
const MAX_ETAG_LENGTH = 512;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface ValidationOptions {
  allowInsecureLoopback: boolean;
}

/** Everything crossing IPC is untrusted: rebuild a clean object or throw ConfigError. */
export function validateSaveConfig(input: unknown, options: ValidationOptions): SyncConfigInput {
  if (!isRecord(input)) throw new ConfigError('Invalid sync settings');
  const { serverUrl, filePath, login, password } = input;

  if (typeof serverUrl !== 'string' || serverUrl.length > MAX_URL_LENGTH) {
    throw new ConfigError('Invalid server URL');
  }
  if (typeof filePath !== 'string') throw new ConfigError('Invalid file path');
  parseWebDavTarget(serverUrl, filePath, options);

  // RFC 7617: the user name must not contain a colon.
  if (
    typeof login !== 'string' ||
    login.length === 0 ||
    login.length > MAX_LOGIN_LENGTH ||
    login.includes(':') ||
    CONTROL_CHARS.test(login)
  ) {
    throw new ConfigError('Invalid login');
  }
  if (
    password !== undefined &&
    (typeof password !== 'string' ||
      password.length > MAX_PASSWORD_LENGTH ||
      CONTROL_CHARS.test(password))
  ) {
    throw new ConfigError('Invalid password');
  }

  return {
    serverUrl: serverUrl.trim(),
    filePath,
    login,
    ...(password ? { password } : {}),
  };
}

export function validateUploadArgs(
  data: unknown,
  etag: unknown,
): { data: string; etag: string | null } {
  if (typeof data !== 'string') throw new ConfigError('Invalid upload payload');
  if (data.length > MAX_UPLOAD_BYTES || Buffer.byteLength(data, 'utf8') > MAX_UPLOAD_BYTES) {
    throw new ConfigError('Upload payload is too large');
  }
  if (etag !== null) {
    // Control characters would allow header injection.
    if (
      typeof etag !== 'string' ||
      etag.length === 0 ||
      etag.length > MAX_ETAG_LENGTH ||
      CONTROL_CHARS.test(etag)
    ) {
      throw new ConfigError('Invalid etag');
    }
  }
  return { data, etag };
}

export function validateNoArgs(args: readonly unknown[]): void {
  if (args.length > 0) throw new ConfigError('Unexpected arguments');
}

/** Only the app's own top-level page may call the API. */
export function isTrustedSender(
  sender: { url: string | undefined; isMainFrame: boolean },
  trustedOrigin: string,
): boolean {
  if (!sender.isMainFrame || sender.url === undefined) return false;
  return originKey(sender.url) === trustedOrigin;
}
