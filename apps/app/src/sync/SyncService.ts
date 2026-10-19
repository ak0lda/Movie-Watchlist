import { ConfigError, type SyncOutcome } from '@movie-watchlist/core';
import { errorKey } from '../errors/errorKey';

export type SyncStatus =
  | { kind: 'idle' }
  | { kind: 'syncing' }
  | { kind: 'synced'; at: number }
  | { kind: 'error'; key: string };

export type SyncReason = 'startup' | 'hidden' | 'manual';

/** The part of SyncEngine the service needs (single-flight lives in the engine). */
export interface SyncRunner {
  sync(): Promise<SyncOutcome>;
}

/** The part of `document` used for the minimise/background trigger. */
export interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

type Listener = () => void;

/**
 * Drives sync from the UI: status for display, plus the triggers (app start, window hidden or
 * minimised, button). Automatic triggers stay quiet when sync is simply not configured yet.
 */
export class SyncService {
  private status: SyncStatus = { kind: 'idle' };
  private readonly listeners = new Set<Listener>();

  constructor(
    private readonly runner: SyncRunner,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  getStatus = (): SyncStatus => this.status;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Runs a sync (or joins the one in flight). Never rejects: failures become the status. */
  async syncNow(reason: SyncReason = 'manual'): Promise<void> {
    this.setStatus({ kind: 'syncing' });
    try {
      await this.runner.sync();
      this.setStatus({ kind: 'synced', at: this.clock() });
    } catch (error) {
      if (reason !== 'manual' && error instanceof ConfigError) {
        this.setStatus({ kind: 'idle' });
      } else {
        this.setStatus({ kind: 'error', key: errorKey(error) });
      }
    }
  }

  /**
   * Syncs once now and again whenever the app goes to the background: the page becomes hidden, or
   * the shell reports a minimised/hidden window (`onWindowHidden`, needed on desktop where page
   * visibility is not reliable). Returns a disposer.
   */
  start(
    source: VisibilitySource,
    onWindowHidden?: (listener: () => void) => () => void,
  ): () => void {
    void this.syncNow('startup');
    const onChange = () => {
      if (source.visibilityState === 'hidden') void this.syncNow('hidden');
    };
    source.addEventListener('visibilitychange', onChange);
    const stopWindowEvents = onWindowHidden?.(() => void this.syncNow('hidden'));
    return () => {
      source.removeEventListener('visibilitychange', onChange);
      stopWindowEvents?.();
    };
  }

  private setStatus(next: SyncStatus): void {
    this.status = next;
    this.listeners.forEach((listener) => listener());
  }
}
