import { isExpiredTombstone, resolveRemoteEntry } from '../merge';
import type { LocalStore } from '../providers';
import type { MovieEntry } from '../types';
import { compareIds } from '../canonical';

/** In-memory LocalStore following the same per-element rule a Dexie transaction would use. */
export class MemoryLocalStore implements LocalStore {
  private readonly entries = new Map<string, MovieEntry>();
  /** Test hook: when set, applyRemote rejects with it. */
  applyError: Error | undefined;

  constructor(initial: readonly MovieEntry[] = []) {
    for (const entry of initial) this.entries.set(entry.id, entry);
  }

  /** Simulates a user edit. */
  put(entry: MovieEntry): void {
    this.entries.set(entry.id, entry);
  }

  get(id: string): MovieEntry | undefined {
    return this.entries.get(id);
  }

  getAll(): Promise<MovieEntry[]> {
    return Promise.resolve([...this.entries.values()].sort(compareIds));
  }

  applyRemote(remote: readonly MovieEntry[], now: Date): Promise<void> {
    if (this.applyError) return Promise.reject(this.applyError);
    for (const entry of remote) {
      const action = resolveRemoteEntry(this.entries.get(entry.id), entry, now);
      if (action.type === 'put') this.entries.set(entry.id, action.entry);
      else if (action.type === 'delete') this.entries.delete(entry.id);
    }
    for (const [id, entry] of this.entries) {
      if (isExpiredTombstone(entry, now)) this.entries.delete(id);
    }
    return Promise.resolve();
  }
}
