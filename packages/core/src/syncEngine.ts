import { canonicalize } from './canonical';
import { ConflictError, NetworkError, StorageError, SyncError } from './errors';
import { merge } from './merge';
import type { LocalStore, SyncProvider } from './providers';
import { parseSyncFile, serializeSyncFile } from './syncFile';
import type { MovieEntry } from './types';

export const DEFAULT_MAX_ATTEMPTS = 3;

export interface SyncEngineOptions {
  provider: SyncProvider;
  store: LocalStore;
  /** Injected clock; defaults to the system time. */
  now?: () => Date;
  /** Download-merge-upload rounds before giving up on repeated conflicts. */
  maxAttempts?: number;
}

export interface SyncOutcome {
  /** False when nothing needed to be written remotely. */
  uploaded: boolean;
  attempts: number;
}

function sameEntries(a: readonly MovieEntry[], b: readonly MovieEntry[]): boolean {
  return (
    a.length === b.length && a.every((entry, i) => canonicalize(entry) === canonicalize(b[i]!))
  );
}

async function wrap<T>(run: () => Promise<T>, fallback: (cause: unknown) => SyncError): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw error instanceof SyncError ? error : fallback(error);
  }
}

/**
 * Cycle: download -> merge -> apply locally -> upload with If-Match; on a conflict download again
 * and retry. At most one sync runs at a time (concurrent calls share the in-flight promise).
 * Local data is never discarded because of a sync error.
 */
export class SyncEngine {
  private readonly provider: SyncProvider;
  private readonly store: LocalStore;
  private readonly now: () => Date;
  private readonly maxAttempts: number;
  private inFlight: Promise<SyncOutcome> | null = null;

  constructor(options: SyncEngineOptions) {
    this.provider = options.provider;
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  sync(): Promise<SyncOutcome> {
    if (this.inFlight) return this.inFlight;
    const run = this.run().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private async run(): Promise<SyncOutcome> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const download = await wrap(
        () => this.provider.download(),
        (cause) => new NetworkError('Unexpected download failure', { cause }),
      );

      // SchemaError for a newer/invalid remote file propagates here, before any write.
      const remote = download.kind === 'found' ? parseSyncFile(download.data).entries : [];
      const etag = download.kind === 'found' ? download.etag : null;
      const now = this.now();

      await wrap(
        () => this.store.applyRemote(remote, now),
        (cause) => new StorageError('Failed to apply remote changes', { cause }),
      );
      const local = await wrap(
        () => this.store.getAll(),
        (cause) => new StorageError('Failed to read local entries', { cause }),
      );

      const merged = merge(local, remote, now);
      const unchanged =
        download.kind === 'found'
          ? sameEntries(merged, merge(remote, [], now))
          : merged.length === 0;
      if (unchanged) return { uploaded: false, attempts: attempt };

      try {
        await wrap(
          () => this.provider.upload(serializeSyncFile(merged), etag),
          (cause) => new NetworkError('Unexpected upload failure', { cause }),
        );
        return { uploaded: true, attempts: attempt };
      } catch (error) {
        if (error instanceof ConflictError && attempt < this.maxAttempts) continue;
        throw error;
      }
    }
    throw new ConflictError(`Gave up after ${this.maxAttempts} conflicting attempts`);
  }
}
