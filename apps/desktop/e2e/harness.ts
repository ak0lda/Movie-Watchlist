import { basicAuthHeader, serializeSyncFile, type MovieEntry } from '@movie-watchlist/core';
import { FakeWebDavServer, makeEntry } from '@movie-watchlist/core/testing';
import {
  _electron as electron,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serveWebDav, type RunningServer } from '../test/helpers';

export const DESKTOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LOGIN = 'e2e-user';
export const PASSWORD = 'e2e-secret-пароль-🔑';
export const FILE_PATH = '/Apps/MovieWatchlist/movies.json';

export interface Instance {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
  /** Closes the app; the user-data folder stays so the app can be started again. */
  close(): Promise<void>;
}

/** Starts the built app with a private user-data folder; windows are hidden unless asked. */
export async function launch(
  userDataDir: string,
  options: { show?: boolean } = {},
): Promise<Instance> {
  const app = await electron.launch({
    args: ['.', '--lang=en-US'],
    cwd: DESKTOP_DIR,
    env: {
      ...process.env,
      MW_E2E: '1',
      ...(options.show ? { MW_E2E_SHOW: '1' } : {}),
      MW_USER_DATA_DIR: userDataDir,
      MW_ALLOW_LOOPBACK_HTTP: '1',
    },
  });
  const page = await app.firstWindow();
  await page.evaluate(() => localStorage.setItem('movie-watchlist.lang', 'en'));
  await page.reload();
  await page.waitForSelector('header');
  return { app, page, userDataDir, close: () => app.close() };
}

export async function makeUserDataDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mw-e2e-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export interface Dav {
  fake: FakeWebDavServer;
  server: RunningServer;
  stop(): Promise<void>;
}

export async function startDav(): Promise<Dav> {
  const fake = new FakeWebDavServer();
  fake.expectedAuthorization = basicAuthHeader(LOGIN, PASSWORD);
  const server = await serveWebDav(fake);
  return { fake, server, stop: () => server.close() };
}

/** Writes a sync-format file to disk for the Import button. */
export async function writeImportFile(dir: string, entries: MovieEntry[]): Promise<string> {
  const file = path.join(dir, `import-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await writeFile(file, serializeSyncFile(entries));
  return file;
}

export function movie(
  tmdbId: number,
  title: string,
  overrides: Partial<MovieEntry> = {},
): MovieEntry {
  return makeEntry({
    tmdbId,
    title,
    originalTitle: title,
    // Real timestamps: edits made through the UI use the current time and must win later.
    addedAt: new Date(Date.now() - 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  });
}

export async function openSettings(page: Page): Promise<void> {
  await page.evaluate(() => (window.location.hash = '#/settings'));
  await page.getByLabel('Server URL').waitFor();
}

export async function importEntries(page: Page, file: string): Promise<void> {
  await openSettings(page);
  await page.locator('input[type=file]').setInputFiles(file);
  await page.getByText(/^Imported \d+ entries/).waitFor();
}

/** Fills the sync form (password write-only) and saves; resolves once the app confirms. */
export async function configureSync(
  page: Page,
  serverUrl: string,
  password = PASSWORD,
): Promise<void> {
  await openSettings(page);
  await page.getByLabel('Server URL').fill(serverUrl);
  await page.getByLabel('Login').fill(LOGIN);
  await page.getByLabel('App password').fill(password);
  await page.getByRole('button', { name: 'Save sync settings' }).click();
  await page.getByText('Sync settings saved').waitFor();
}

/** Text of the header sync status ("Synchronized", an error message, ...). */
export async function syncStatus(page: Page): Promise<string> {
  return (await page.locator('.sync [role=status]').textContent()) ?? '';
}

/**
 * Clicks the header Sync button and waits for the expected status. When a server is given, the
 * status only counts once new requests reached it, so a stale "Synchronized" cannot satisfy the wait.
 */
export async function syncNow(page: Page, expected = 'Synchronized', dav?: Dav): Promise<void> {
  const before = dav?.fake.requests.length ?? 0;
  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await syncStatus(page)) === expected && (!dav || dav.fake.requests.length > before),
    )
    .toBe(true);
}

export async function showList(page: Page): Promise<void> {
  await page.evaluate(() => (window.location.hash = '#/'));
  await page.getByRole('heading', { name: 'My list' }).waitFor();
}

export async function listedTitles(page: Page): Promise<string[]> {
  await showList(page);
  // Let Dexie live queries settle.
  await page.waitForTimeout(200);
  return page.locator('ul.items li strong').allTextContents();
}
