import {
  ConfigError,
  WebDavSyncProvider,
  type DownloadResult,
  type HttpTransport,
  type SyncConfigInput,
  type SyncConfigView,
} from '@movie-watchlist/core';
import { DEFAULT_FILE_PATH, DEFAULT_SERVER_URL, type ConfigStore } from './configStore';
import { originKey } from '../shared/origin';
import type { SecretStore } from './secretStore';

/** What the IPC handlers call. */
export interface SyncBackend {
  getConfigView(): Promise<SyncConfigView>;
  saveConfig(input: SyncConfigInput): Promise<SyncConfigView>;
  clearPassword(): Promise<SyncConfigView>;
  download(): Promise<DownloadResult>;
  upload(data: string, etag: string | null): Promise<{ etag: string | null }>;
}

export interface MainSyncBackendDeps {
  configStore: ConfigStore;
  secretStore: SecretStore;
  transport: HttpTransport;
  allowInsecureLoopback: boolean;
}

const originOf = (url: string): string => originKey(url) ?? url;

/** Main-process side of sync: owns the password and performs all network access. */
export class MainSyncBackend implements SyncBackend {
  constructor(private readonly deps: MainSyncBackendDeps) {}

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
    const previous = await this.deps.configStore.load();
    const hasPassword = (await this.deps.secretStore.get()) !== null;

    // Never let a stored password follow a changed server or login: otherwise a compromised
    // renderer could point the app at its own server and collect the saved credentials.
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
      serverUrl: input.serverUrl,
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
