import {
  unwrapBridgeResult,
  type DesktopApi,
  type DownloadResult,
  type SyncProvider,
} from '@movie-watchlist/core';

/** SyncProvider backed by the Electron main process: all network access happens there. */
export class IpcSyncProvider implements SyncProvider {
  constructor(private readonly api: DesktopApi['sync']) {}

  async download(): Promise<DownloadResult> {
    return unwrapBridgeResult(await this.api.download());
  }

  async upload(data: string, etag: string | null): Promise<{ etag: string | null }> {
    return unwrapBridgeResult(await this.api.upload(data, etag));
  }
}
