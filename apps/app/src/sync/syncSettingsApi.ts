import {
  unwrapBridgeResult,
  type DesktopApi,
  type SyncConfigInput,
  type SyncConfigView,
} from '@movie-watchlist/core';

/** What the settings screen needs; the password is write-only and never read back. */
export interface SyncSettingsApi {
  getConfig(): Promise<SyncConfigView>;
  saveConfig(input: SyncConfigInput): Promise<SyncConfigView>;
  clearPassword(): Promise<SyncConfigView>;
}

export function createSyncSettingsApi(api: DesktopApi['sync']): SyncSettingsApi {
  return {
    getConfig: async () => unwrapBridgeResult(await api.getConfig()),
    saveConfig: async (input) => unwrapBridgeResult(await api.saveConfig(input)),
    clearPassword: async () => unwrapBridgeResult(await api.clearPassword()),
  };
}
