import { ConfigError } from './errors';
import type { SyncConfigInput, SyncConfigView } from './desktopBridge';
import type { DownloadResult } from './providers';
import { DEFAULT_FILE_PATH, DEFAULT_SERVER_URL } from './syncDefaults';
import { WebDavSyncProvider, parseWebDavTarget, type HttpTransport } from './webdav';

export interface StoredSyncConfig {
  serverUrl: string;
  filePath: string;
  login: string;
}

/** Non-secret settings storage (a JSON file on desktop, localStorage on Android). */
export interface SyncConfigPort {
  load(): Promise<StoredSyncConfig | null>;
  save(config: StoredSyncConfig): Promise<void>;
}

/** The app password, stored encrypted by the platform (safeStorage / Android Keystore). */
export interface SyncSecretPort {
  /** Null when nothing is stored or it cannot be decrypted. */
  get(): Promise<string | null>;
  set(password: string): Promise<void>;
  clear(): Promise<void>;
}

/** Everything a platform's sync settings screen and sync provider need. */
export interface SyncBackend {
  getConfigView(): Promise<SyncConfigView>;
  saveConfig(input: SyncConfigInput): Promise<SyncConfigView>;
  clearPassword(): Promise<SyncConfigView>;
  download(): Promise<DownloadResult>;
  upload(data: string, etag: string | null): Promise<{ etag: string | null }>;
}

export interface ConfiguredSyncBackendDeps {
  configStore: SyncConfigPort;
  secretStore: SyncSecretPort;
  transport: HttpTransport;
  /** Permits plain http for loopback hosts only (tests and local development). */
  allowInsecureLoopback: boolean;
}

function originOf(url: string): string {
  try {
    return new URL(url.trim()).origin;
  } catch {
    return url.trim();
  }
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Shared sync logic behind every platform's settings and provider: validated settings, a write-only
 * password, and a WebDavSyncProvider built per call so the password is read only when needed.
 */
export class ConfiguredSyncBackend implements SyncBackend {
  constructor(private readonly deps: ConfiguredSyncBackendDeps) {}

  async getConfigView(): Promise<SyncConfigView> {
    const stored = await this.deps.configStore.load();
    return {
      serverUrl: stored?.serverUrl ?? DEFAULT_SERVER_URL,
      filePath: stored?.filePath ?? DEFAULT_FILE_PATH,
      login: stored?.login ?? '',
      hasPassword: (await this.deps.secretStore.get()) !== null,
    };
  }

  async saveConfig(input: SyncConfigInput): Promise<SyncConfigView> {
    parseWebDavTarget(input.serverUrl, input.filePath, {
      allowInsecureLoopback: this.deps.allowInsecureLoopback,
    });
    if (!input.login || input.login.includes(':') || CONTROL_CHARS.test(input.login)) {
      throw new ConfigError('Invalid login');
    }

    const previous = await this.deps.configStore.load();
    const hasPassword = (await this.deps.secretStore.get()) !== null;

    // Never let a stored password follow a changed server or login: otherwise a compromised
    // page could point the app at its own server and collect the saved credentials.
    if (!input.password && hasPassword) {
      const destinationChanged =
        previous === null ||
        originOf(previous.serverUrl) !== originOf(input.serverUrl) ||
        previous.login !== input.login;
      if (destinationChanged) {
        throw new ConfigError(
          'The password must be entered again when the server or login changes',
        );
      }
    }

    if (input.password) await this.deps.secretStore.set(input.password);
    await this.deps.configStore.save({
      serverUrl: input.serverUrl.trim(),
      filePath: input.filePath,
      login: input.login,
    });
    return this.getConfigView();
  }

  async clearPassword(): Promise<SyncConfigView> {
    await this.deps.secretStore.clear();
    return this.getConfigView();
  }

  async download(): Promise<DownloadResult> {
    return (await this.provider()).download();
  }

  async upload(data: string, etag: string | null): Promise<{ etag: string | null }> {
    return (await this.provider()).upload(data, etag);
  }

  private async provider(): Promise<WebDavSyncProvider> {
    const config = await this.deps.configStore.load();
    const password = await this.deps.secretStore.get();
    if (!config || !config.login || password === null) {
      throw new ConfigError('Sync is not configured');
    }
    return new WebDavSyncProvider({
      transport: this.deps.transport,
      config: { ...config, password },
      allowInsecureLoopback: this.deps.allowInsecureLoopback,
    });
  }
}
