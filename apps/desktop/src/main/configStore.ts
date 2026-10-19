import { readFile } from 'node:fs/promises';
import {
  DEFAULT_FILE_PATH,
  DEFAULT_SERVER_URL,
  type StoredSyncConfig,
  type SyncConfigPort,
} from '@movie-watchlist/core';
import { isNotFound, writeFileAtomic } from './fsUtil';

export { DEFAULT_FILE_PATH, DEFAULT_SERVER_URL, type StoredSyncConfig };

/** Non-secret sync settings in a JSON file. A missing or corrupt file means "not configured". */
export class ConfigStore implements SyncConfigPort {
  constructor(private readonly filePath: string) {}

  async load(): Promise<StoredSyncConfig | null> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null) return null;
      const { serverUrl, filePath, login } = parsed as Record<string, unknown>;
      if (
        typeof serverUrl !== 'string' ||
        typeof filePath !== 'string' ||
        typeof login !== 'string'
      ) {
        return null;
      }
      return { serverUrl, filePath, login };
    } catch {
      return null;
    }
  }

  async save(config: StoredSyncConfig): Promise<void> {
    const { serverUrl, filePath, login } = config;
    await writeFileAtomic(
      this.filePath,
      `${JSON.stringify({ serverUrl, filePath, login }, null, 2)}\n`,
    );
  }
}
