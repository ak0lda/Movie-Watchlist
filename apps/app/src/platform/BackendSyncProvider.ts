import type { DownloadResult, SyncBackend, SyncProvider } from '@movie-watchlist/core';
import type { SyncSettingsApi } from '../sync/syncSettingsApi';

/** SyncProvider that talks to an in-process backend (Android: no separate main process). */
export class BackendSyncProvider implements SyncProvider {
  constructor(private readonly backend: SyncBackend) {}

  download(): Promise<DownloadResult> {
    return this.backend.download();
  }

  upload(data: string, etag: string | null): Promise<{ etag: string | null }> {
    return this.backend.upload(data, etag);
  }
}

export function settingsApiFromBackend(backend: SyncBackend): SyncSettingsApi {
  return {
    getConfig: () => backend.getConfigView(),
    saveConfig: (input) => backend.saveConfig(input),
    clearPassword: () => backend.clearPassword(),
  };
}
