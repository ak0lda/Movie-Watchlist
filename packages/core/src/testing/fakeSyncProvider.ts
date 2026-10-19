import { ConflictError } from '../errors';
import type { DownloadResult, SyncProvider } from '../providers';
import { parseSyncFile, serializeSyncFile } from '../syncFile';
import type { MovieEntry } from '../types';

type Operation = 'download' | 'upload';

/** WebDAV-like fake: opaque etag, create-only with null etag, 412 -> ConflictError. */
export class FakeSyncProvider implements SyncProvider {
  file: { data: string; etag: string } | null = null;
  downloads = 0;
  uploadAttempts = 0;
  uploads = 0;
  /** Runs inside download() before the result is returned (simulates time passing). */
  onDownload: (() => void | Promise<void>) | undefined;
  /** Runs at the start of upload() (simulates another device writing in between). */
  onBeforeUpload: (() => void | Promise<void>) | undefined;
  private version = 0;
  private readonly queued: Record<Operation, Error[]> = { download: [], upload: [] };

  /** The next `times` calls of `operation` reject with `error`. */
  failNext(operation: Operation, error: Error, times = 1): void {
    for (let i = 0; i < times; i++) this.queued[operation].push(error);
  }

  /** Writes the file as another device would, producing a fresh etag. */
  writeRemote(entries: readonly MovieEntry[]): void {
    this.writeRaw(serializeSyncFile(entries));
  }

  writeRaw(data: string): void {
    this.version += 1;
    this.file = { data, etag: `"v${this.version}"` };
  }

  remoteEntries(): MovieEntry[] {
    return this.file ? parseSyncFile(this.file.data).entries : [];
  }

  async download(): Promise<DownloadResult> {
    this.downloads += 1;
    const error = this.queued.download.shift();
    if (error) throw error;
    await this.onDownload?.();
    return this.file ? { kind: 'found', ...this.file } : { kind: 'not-found' };
  }

  async upload(data: string, etag: string | null): Promise<{ etag: string | null }> {
    this.uploadAttempts += 1;
    await this.onBeforeUpload?.();
    const error = this.queued.upload.shift();
    if (error) throw error;
    const matches = this.file === null ? etag === null : etag === this.file.etag;
    if (!matches) throw new ConflictError('412 Precondition Failed');
    this.writeRaw(data);
    this.uploads += 1;
    return { etag: this.file?.etag ?? null };
  }
}
