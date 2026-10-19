import {
  AuthError,
  ConfigError,
  ConflictError,
  NetworkError,
  SchemaError,
  StorageError,
  SyncError,
  type SyncErrorCode,
} from './errors';
import type { DownloadResult } from './providers';

/** What the renderer may know about the stored sync settings. The password never travels back. */
export interface SyncConfigView {
  serverUrl: string;
  filePath: string;
  login: string;
  hasPassword: boolean;
}

export interface SyncConfigInput {
  serverUrl: string;
  filePath: string;
  login: string;
  /** Omitted or empty keeps the stored password. */
  password?: string;
}

export interface SerializedSyncError {
  code: SyncErrorCode;
  message: string;
  reason?: 'newer-version' | 'invalid';
  foundVersion?: number;
}

export type BridgeResult<T> = { ok: true; value: T } | { ok: false; error: SerializedSyncError };

/** Narrow API exposed to the renderer by the Electron preload script. */
export interface DesktopApi {
  readonly sync: {
    getConfig(): Promise<BridgeResult<SyncConfigView>>;
    saveConfig(input: SyncConfigInput): Promise<BridgeResult<SyncConfigView>>;
    clearPassword(): Promise<BridgeResult<SyncConfigView>>;
    download(): Promise<BridgeResult<DownloadResult>>;
    upload(data: string, etag: string | null): Promise<BridgeResult<{ etag: string | null }>>;
  };
  /**
   * Calls `listener` when the window is minimised or hidden. Page visibility events are not
   * reliable for that in Electron, so the main process reports the window events itself.
   * Returns an unsubscribe function.
   */
  onWindowHidden(listener: () => void): () => void;
}

export const DESKTOP_API_METHODS = [
  'sync.getConfig',
  'sync.saveConfig',
  'sync.clearPassword',
  'sync.download',
  'sync.upload',
] as const;

/** Unknown errors are reported as a generic network failure; their text is never forwarded. */
export function serializeSyncError(error: unknown): SerializedSyncError {
  if (error instanceof SchemaError) {
    return {
      code: 'schema',
      message: error.message,
      reason: error.reason,
      ...(error.foundVersion === undefined ? {} : { foundVersion: error.foundVersion }),
    };
  }
  if (error instanceof SyncError) return { code: error.code, message: error.message };
  return { code: 'network', message: 'Unexpected error' };
}

export function deserializeSyncError(serialized: SerializedSyncError): SyncError {
  switch (serialized.code) {
    case 'auth':
      return new AuthError(serialized.message);
    case 'conflict':
      return new ConflictError(serialized.message);
    case 'config':
      return new ConfigError(serialized.message);
    case 'storage':
      return new StorageError(serialized.message);
    case 'schema':
      return new SchemaError(serialized.reason ?? 'invalid', serialized.message, {
        ...(serialized.foundVersion === undefined ? {} : { foundVersion: serialized.foundVersion }),
      });
    case 'network':
      return new NetworkError(serialized.message);
  }
}

export function ok<T>(value: T): BridgeResult<T> {
  return { ok: true, value };
}

export function fail(error: unknown): BridgeResult<never> {
  return { ok: false, error: serializeSyncError(error) };
}

/** Runs `action` and wraps its outcome (including typed errors) in a BridgeResult. */
export async function toBridgeResult<T>(action: () => Promise<T>): Promise<BridgeResult<T>> {
  try {
    return ok(await action());
  } catch (error) {
    return fail(error);
  }
}

/** Renderer side: returns the value or throws the rebuilt typed error. */
export function unwrapBridgeResult<T>(result: BridgeResult<T>): T {
  if (result.ok) return result.value;
  throw deserializeSyncError(result.error);
}
