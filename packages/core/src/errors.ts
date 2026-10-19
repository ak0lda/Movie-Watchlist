/** Stable codes; the UI maps them to translation keys. */
export type SyncErrorCode = 'network' | 'auth' | 'conflict' | 'schema' | 'storage';

export class SyncError extends Error {
  readonly code: SyncErrorCode;

  constructor(code: SyncErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Unreachable server, timeout, 5xx, any unexpected provider failure. */
export class NetworkError extends SyncError {
  constructor(message = 'Network error', options?: ErrorOptions) {
    super('network', message, options);
  }
}

/** Rejected credentials or insufficient access. */
export class AuthError extends SyncError {
  constructor(message = 'Authentication failed', options?: ErrorOptions) {
    super('auth', message, options);
  }
}

/** Precondition failed (HTTP 412 or `If-None-Match: *` on an existing file). */
export class ConflictError extends SyncError {
  constructor(message = 'Remote file changed concurrently', options?: ErrorOptions) {
    super('conflict', message, options);
  }
}

export type SchemaErrorReason = 'newer-version' | 'invalid';

/** Remote file is unreadable or written by a newer app version. Never overwrite it. */
export class SchemaError extends SyncError {
  readonly reason: SchemaErrorReason;
  readonly foundVersion: number | undefined;

  constructor(
    reason: SchemaErrorReason,
    message: string,
    details: { foundVersion?: number; cause?: unknown } = {},
  ) {
    super('schema', message, details.cause === undefined ? undefined : { cause: details.cause });
    this.reason = reason;
    this.foundVersion = details.foundVersion;
  }
}

/** Local store failure while applying remote changes. */
export class StorageError extends SyncError {
  constructor(message = 'Local storage failed', options?: ErrorOptions) {
    super('storage', message, options);
  }
}
