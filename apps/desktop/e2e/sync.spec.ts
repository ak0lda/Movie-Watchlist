import { serializeSyncFile, parseSyncFile } from '@movie-watchlist/core';
import { expect, test, type Page } from '@playwright/test';
import {
  FILE_PATH,
  configureSync,
  importEntries,
  launch,
  listedTitles,
  makeUserDataDir,
  movie,
  showList,
  startDav,
  syncNow,
  syncStatus,
  writeImportFile,
  type Dav,
  type Instance,
} from './harness';

interface Env {
  dav: Dav;
  dirs: { dir: string; cleanup: () => Promise<void> }[];
  instances: Instance[];
}

let env: Env;
test.beforeEach(async () => {
  env = { dav: await startDav(), dirs: [], instances: [] };
});
test.afterEach(async () => {
  for (const instance of env.instances) await instance.close().catch(() => undefined);
  await env.dav.stop().catch(() => undefined);
  for (const dir of env.dirs) await dir.cleanup();
});

async function device(
  options: { show?: boolean; configure?: boolean; dir?: string } = {},
): Promise<Instance> {
  let dir = options.dir;
  if (!dir) {
    const made = await makeUserDataDir();
    env.dirs.push(made);
    dir = made.dir;
  }
  const instance = await launch(dir, options.show ? { show: true } : {});
  env.instances.push(instance);
  if (options.configure !== false) await configureSync(instance.page, env.dav.server.url);
  return instance;
}

async function seed(instance: Instance, ...titles: [number, string][]) {
  const file = await writeImportFile(
    instance.userDataDir,
    titles.map(([id, title]) => movie(id, title)),
  );
  await importEntries(instance.page, file);
}

async function openEntry(page: Page, tmdbId: number) {
  await page.evaluate((id) => (window.location.hash = `#/title/movie/${id}`), tmdbId);
  await page.getByLabel('Status').waitFor();
}

async function setStatus(page: Page, status: string, note?: string) {
  await page.getByLabel('Status').selectOption(status);
  if (note !== undefined) await page.getByLabel('Note').fill(note);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('Saved', { exact: true }).waitFor();
}

const remoteEntries = () => parseSyncFile(env.dav.fake.readFile(FILE_PATH)!.body).entries;

test('two devices: first sync creates the file and folders, the second device receives the entries', async () => {
  const a = await device();
  const b = await device();
  await seed(a, [1, 'Alpha'], [2, 'Bravo']);
  expect(env.dav.fake.hasFolder('/Apps')).toBe(false);

  await syncNow(a.page, 'Synchronized', env.dav);
  expect(env.dav.fake.hasFolder('/Apps/MovieWatchlist')).toBe(true);
  expect(
    remoteEntries()
      .map((e) => e.title)
      .sort(),
  ).toEqual(['Alpha', 'Bravo']);

  await syncNow(b.page, 'Synchronized', env.dav);
  expect((await listedTitles(b.page)).sort()).toEqual(['Alpha', 'Bravo']);
});

test('edits made on both devices converge, last writer wins', async () => {
  const a = await device();
  const b = await device();
  await seed(a, [1, 'Alpha']);
  await syncNow(a.page, 'Synchronized', env.dav);
  await syncNow(b.page, 'Synchronized', env.dav);

  await openEntry(a.page, 1);
  await setStatus(a.page, 'watched', 'seen on A');
  await syncNow(a.page, 'Synchronized', env.dav);

  // B edits later, so its version must win everywhere.
  await openEntry(b.page, 1);
  await setStatus(b.page, 'watching', 'seen on B');
  await syncNow(b.page, 'Synchronized', env.dav);
  await syncNow(a.page, 'Synchronized', env.dav);

  for (const page of [a.page, b.page]) {
    await showList(page);
    await expect(page.locator('ul.items li').first()).toContainText('Watching');
  }
  expect(remoteEntries()[0]).toMatchObject({ status: 'watching', note: 'seen on B' });
});

test('a deletion on one device removes the entry on the other (tombstone)', async () => {
  const a = await device();
  const b = await device();
  await seed(a, [1, 'Alpha'], [2, 'Bravo']);
  await syncNow(a.page, 'Synchronized', env.dav);
  await syncNow(b.page, 'Synchronized', env.dav);

  await openEntry(b.page, 2);
  await b.page.getByRole('button', { name: 'Remove from list' }).click();
  await b.page.getByRole('button', { name: 'Yes, remove' }).click();
  await b.page.getByRole('button', { name: 'Add to list' }).waitFor();
  await syncNow(b.page, 'Synchronized', env.dav);
  await syncNow(a.page, 'Synchronized', env.dav);

  expect(await listedTitles(a.page)).toEqual(['Alpha']);
  expect(remoteEntries().find((e) => e.id === 'movie:2')).toMatchObject({ deleted: true });
});

test('a concurrent write between download and upload is retried (real 412 path)', async () => {
  const a = await device();
  await seed(a, [1, 'Alpha']);
  await syncNow(a.page, 'Synchronized', env.dav);

  await seed(a, [2, 'Bravo']);
  let raced = false;
  env.dav.fake.beforeRequest = (request) => {
    if (request.method !== 'PUT' || raced) return;
    raced = true;
    // Another client wins the race with its own entry.
    env.dav.fake.writeFile(FILE_PATH, serializeSyncFile([movie(1, 'Alpha'), movie(9, 'Zulu')]));
  };
  await syncNow(a.page, 'Synchronized', env.dav);

  expect(raced).toBe(true);
  expect(
    remoteEntries()
      .map((e) => e.title)
      .sort(),
  ).toEqual(['Alpha', 'Bravo', 'Zulu']);
  expect((await listedTitles(a.page)).sort()).toEqual(['Alpha', 'Bravo', 'Zulu']);
});

test('starting the app pulls remote changes without clicking anything', async () => {
  const dirA = await makeUserDataDir();
  env.dirs.push(dirA);
  const first = await device({ dir: dirA.dir });
  await first.close();
  env.instances.splice(env.instances.indexOf(first), 1);

  env.dav.fake.writeFile(FILE_PATH, serializeSyncFile([movie(5, 'Echo')]));
  const restarted = await device({ dir: dirA.dir, configure: false });
  await expect.poll(() => listedTitles(restarted.page), { timeout: 20_000 }).toContain('Echo');
});

test('hiding or minimising the window triggers a sync', async () => {
  const a = await device({ show: true });
  await seed(a, [7, 'Foxtrot']);
  expect(env.dav.fake.readFile(FILE_PATH)).toBeUndefined();

  await a.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.minimize());
  await expect
    .poll(() => env.dav.fake.readFile(FILE_PATH)?.body ?? '', { timeout: 20_000 })
    .toContain('Foxtrot');
});

test.describe('failures leave local data intact and are shown in the UI language', () => {
  test('unreachable server', async () => {
    const a = await device();
    await seed(a, [1, 'Alpha']);
    await env.dav.stop();
    await syncNow(a.page, 'Could not reach the sync server.');
    expect(await listedTitles(a.page)).toEqual(['Alpha']);
  });

  test('wrong password', async () => {
    const a = await device();
    await seed(a, [1, 'Alpha']);
    env.dav.fake.expectedAuthorization = 'Basic definitely-not-it';
    await syncNow(a.page, 'The sync server rejected the credentials.', env.dav);
    expect(env.dav.fake.readFile(FILE_PATH)).toBeUndefined();
    expect(await listedTitles(a.page)).toEqual(['Alpha']);
  });

  test('provider that denies writes with HTTP 402 (as Yandex did without a paid plan)', async () => {
    const a = await device();
    await seed(a, [1, 'Alpha']);
    env.dav.fake.respondWith((r) => r.method !== 'GET', { status: 402, headers: {}, body: '' }, 20);
    await syncNow(a.page, 'The sync server rejected the credentials.', env.dav);
    expect(await listedTitles(a.page)).toEqual(['Alpha']);
  });

  test('a file written by a newer app version is never overwritten', async () => {
    const a = await device();
    await seed(a, [1, 'Alpha']);
    const foreign = JSON.stringify({ schemaVersion: 99, entries: [], future: true });
    env.dav.fake.writeFile(FILE_PATH, foreign);
    await syncNow(a.page, 'This file was created by a newer version of the app.', env.dav);
    expect(env.dav.fake.readFile(FILE_PATH)?.body).toBe(foreign);
    expect(env.dav.fake.requestsOf('PUT')).toHaveLength(0);
    expect(await listedTitles(a.page)).toEqual(['Alpha']);
  });

  test('an unreadable remote file is never overwritten either', async () => {
    const a = await device();
    await seed(a, [1, 'Alpha']);
    env.dav.fake.writeFile(FILE_PATH, 'this is not json');
    await syncNow(a.page, 'This file is not a valid watchlist file.', env.dav);
    expect(env.dav.fake.readFile(FILE_PATH)?.body).toBe('this is not json');
  });

  test('not configured: the button explains it and nothing touches the network', async () => {
    const a = await device({ configure: false });
    await syncNow(
      a.page,
      'Sync is not set up correctly. Check that the server URL starts with https://, the path is absolute, and the login and password are saved.',
    );
    expect(env.dav.fake.requests).toHaveLength(0);
  });

  test('recovers on the next click once the problem is fixed', async () => {
    const a = await device();
    await seed(a, [1, 'Alpha']);
    env.dav.fake.expectedAuthorization = 'Basic nope';
    await syncNow(a.page, 'The sync server rejected the credentials.', env.dav);
    env.dav.fake.expectedAuthorization = undefined;
    await syncNow(a.page, 'Synchronized', env.dav);
    expect(remoteEntries().map((e) => e.title)).toEqual(['Alpha']);
    expect(await syncStatus(a.page)).toBe('Synchronized');
  });
});
