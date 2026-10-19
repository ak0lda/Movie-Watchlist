import { basicAuthHeader } from '@movie-watchlist/core';
import { expect, test } from '@playwright/test';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  FILE_PATH,
  LOGIN,
  PASSWORD,
  configureSync,
  launch,
  makeUserDataDir,
  openSettings,
  startDav,
  syncNow,
} from './harness';

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

test('stores the password encrypted by the OS (safeStorage), keeps it across restarts and uses it', async () => {
  const data = await makeUserDataDir();
  const dav = await startDav();
  const first = await launch(data.dir);
  try {
    await configureSync(first.page, dav.server.url);

    const configText = await readFile(path.join(data.dir, 'sync-config.json'), 'utf8');
    expect(JSON.parse(configText)).toEqual({
      serverUrl: dav.server.url,
      filePath: FILE_PATH,
      login: LOGIN,
    });
    expect(configText).not.toContain('e2e-secret');

    const secret = await readFile(path.join(data.dir, 'sync-secret.bin'));
    expect(secret.length).toBeGreaterThan(16);
    for (const needle of ['e2e-secret', PASSWORD, 'пароль']) {
      expect(secret.includes(Buffer.from(needle, 'utf8'))).toBe(false);
      expect(secret.includes(Buffer.from(needle, 'utf16le'))).toBe(false);
    }

    // The form never shows the stored password, not even after saving.
    await expect(first.page.getByLabel('App password')).toHaveValue('');
    await expect(first.page.getByLabel('App password')).toHaveAttribute(
      'placeholder',
      'Saved. Leave empty to keep it',
    );
    expect(await first.page.content()).not.toContain('e2e-secret');
    await first.close();

    const second = await launch(data.dir);
    try {
      await openSettings(second.page);
      await expect(second.page.getByLabel('Login')).toHaveValue(LOGIN);
      await expect(second.page.getByLabel('Server URL')).toHaveValue(dav.server.url);
      await expect(second.page.getByLabel('App password')).toHaveValue('');
      await expect(second.page.getByLabel('App password')).toHaveAttribute(
        'placeholder',
        'Saved. Leave empty to keep it',
      );

      // The decrypted password works: the server only answers requests carrying it.
      dav.fake.requests.length = 0;
      await syncNow(second.page, 'Synchronized', dav);
      const authorizations = dav.fake.requests.map((request) => request.headers['Authorization']);
      expect(authorizations.length).toBeGreaterThan(0);
      expect(new Set(authorizations)).toEqual(new Set([basicAuthHeader(LOGIN, PASSWORD)]));

      // Forgetting removes the encrypted blob.
      await openSettings(second.page);
      await second.page.getByRole('button', { name: 'Forget password' }).click();
      await second.page.getByText('Password removed from this device').waitFor();
      expect(await exists(path.join(data.dir, 'sync-secret.bin'))).toBe(false);
      await expect(second.page.getByLabel('App password')).toHaveAttribute('placeholder', '');
    } finally {
      await second.close();
    }
  } finally {
    await dav.stop();
    await data.cleanup();
  }
});

test('refuses plain http for a non-loopback server and saves nothing', async () => {
  const data = await makeUserDataDir();
  const instance = await launch(data.dir);
  try {
    await openSettings(instance.page);
    await instance.page.getByLabel('Server URL').fill('http://example.com');
    await instance.page.getByLabel('Login').fill(LOGIN);
    await instance.page.getByLabel('App password').fill(PASSWORD);
    await instance.page.getByRole('button', { name: 'Save sync settings' }).click();
    await expect(instance.page.getByRole('alert')).toContainText('Sync is not set up correctly');
    expect(await exists(path.join(data.dir, 'sync-config.json'))).toBe(false);
    expect(await exists(path.join(data.dir, 'sync-secret.bin'))).toBe(false);
  } finally {
    await instance.close();
    await data.cleanup();
  }
});

test('a changed server never inherits the stored password (checked through the real IPC)', async () => {
  const data = await makeUserDataDir();
  const dav = await startDav();
  const instance = await launch(data.dir);
  try {
    await configureSync(instance.page, dav.server.url);
    const before = await readFile(path.join(data.dir, 'sync-config.json'), 'utf8');

    const attempts = await instance.page.evaluate(
      async ({ url, filePath, login }) => {
        const sync = window.desktop!.sync;
        return {
          // A compromised page tries to point the app at its own server without a password.
          otherServer: await sync.saveConfig({ serverUrl: 'http://127.0.0.1:9', filePath, login }),
          otherLogin: await sync.saveConfig({ serverUrl: url, filePath, login: 'someone-else' }),
          // The same destination is fine without a password.
          sameDestination: await sync.saveConfig({
            serverUrl: url,
            filePath: '/other/movies.json',
            login,
          }),
        };
      },
      { url: dav.server.url, filePath: FILE_PATH, login: LOGIN },
    );
    expect(attempts.otherServer).toMatchObject({ ok: false, error: { code: 'config' } });
    expect(attempts.otherLogin).toMatchObject({ ok: false, error: { code: 'config' } });
    expect(attempts.sameDestination).toMatchObject({ ok: true, value: { hasPassword: true } });
    expect(JSON.parse(before)).toMatchObject({ login: LOGIN, serverUrl: dav.server.url });
    expect(
      JSON.parse(await readFile(path.join(data.dir, 'sync-config.json'), 'utf8')).filePath,
    ).toBe('/other/movies.json');
  } finally {
    await instance.close();
    await dav.stop();
    await data.cleanup();
  }
});

test('UI asks for the password again when the login changes', async () => {
  const data = await makeUserDataDir();
  const dav = await startDav();
  const instance = await launch(data.dir);
  try {
    await configureSync(instance.page, dav.server.url);
    await instance.page.getByLabel('Login').fill('another-login');
    await instance.page.getByRole('button', { name: 'Save sync settings' }).click();
    await expect(instance.page.getByRole('alert')).toContainText('Enter the password');
    const config = JSON.parse(await readFile(path.join(data.dir, 'sync-config.json'), 'utf8'));
    expect(config.login).toBe(LOGIN);
  } finally {
    await instance.close();
    await dav.stop();
    await data.cleanup();
  }
});
