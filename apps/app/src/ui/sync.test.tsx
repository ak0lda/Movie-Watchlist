// @vitest-environment jsdom
import { ConfigError, NetworkError } from '@movie-watchlist/core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import i18n from '../i18n';
import { ServicesProvider } from '../services';
import { createTestServices } from '../testing/helpers';

type TestServices = ReturnType<typeof createTestServices>;

function renderApp(test: TestServices, hash = '#/') {
  window.location.hash = hash;
  return render(
    <ServicesProvider value={test.services}>
      <App />
    </ServicesProvider>,
  );
}

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});
afterEach(() => cleanup());

describe('sync button', () => {
  it('is absent in plain browser mode (no sync backend)', () => {
    renderApp(createTestServices());
    expect(screen.queryByRole('button', { name: 'Sync' })).toBeNull();
  });

  it('starts a sync, is disabled while running and reports success', async () => {
    const user = userEvent.setup();
    const test = createTestServices({ sync: true });
    let release!: () => void;
    test.runner.gate = new Promise<void>((resolve) => (release = resolve));
    renderApp(test);

    await user.click(screen.getByRole('button', { name: 'Sync' }));
    expect(test.runner.calls).toBe(1);
    expect(await screen.findByText('Syncing…')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sync' }) as HTMLButtonElement).disabled).toBe(true);

    release();
    expect(await screen.findByText('Synchronized')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Sync' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('shows a translated error and follows the UI language', async () => {
    const user = userEvent.setup();
    const test = createTestServices({ sync: true });
    test.runner.error = new NetworkError('offline');
    renderApp(test);
    await user.click(screen.getByRole('button', { name: 'Sync' }));
    expect(await screen.findByText('Could not reach the sync server.')).toBeTruthy();

    await i18n.changeLanguage('ru');
    expect(await screen.findByText('Не удалось связаться с сервером синхронизации.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Синхронизировать' })).toBeTruthy();
  });

  it('tells the user when sync is not set up (manual click)', async () => {
    const user = userEvent.setup();
    const test = createTestServices({ sync: true });
    test.runner.error = new ConfigError('Sync is not configured');
    renderApp(test);
    await user.click(screen.getByRole('button', { name: 'Sync' }));
    expect((await screen.findByRole('status')).textContent).toContain(
      'Sync is not set up correctly',
    );
  });
});

describe('sync settings', () => {
  async function openSettings(test: TestServices = createTestServices({ sync: true })) {
    renderApp(test, '#/settings');
    await screen.findByLabelText('Server URL');
    return test;
  }
  const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

  it('is hidden without a sync backend', async () => {
    renderApp(createTestServices(), '#/settings');
    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.queryByLabelText('Server URL')).toBeNull();
  });

  it('loads the stored settings and defaults', async () => {
    const test = createTestServices({ sync: true });
    test.syncSettings.config = { ...test.syncSettings.config, login: 'me@yandex.ru' };
    await openSettings(test);
    expect(field('Server URL').value).toBe('https://webdav.yandex.ru');
    expect(field('File path on the server').value).toBe('/Apps/MovieWatchlist/movies.json');
    expect(field('Login').value).toBe('me@yandex.ru');
  });

  it('never shows a stored password: the field stays empty with a hint', async () => {
    const test = createTestServices({ sync: true });
    test.syncSettings.config = { ...test.syncSettings.config, login: 'me', hasPassword: true };
    await openSettings(test);
    const password = field('App password');
    expect(password.type).toBe('password');
    expect(password.value).toBe('');
    expect(password.placeholder).toBe('Saved. Leave empty to keep it');
  });

  it('requires a password for the first save', async () => {
    const user = userEvent.setup();
    const test = await openSettings();
    await user.type(field('Login'), 'me');
    await user.click(screen.getByRole('button', { name: 'Save sync settings' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Enter the password');
    expect(test.syncSettings.saves).toEqual([]);
  });

  it('saves with the typed password, clears the field and never echoes it', async () => {
    const user = userEvent.setup();
    const test = await openSettings();
    await user.type(field('Login'), 'me@yandex.ru');
    await user.type(field('App password'), 'top-secret-123');
    await user.click(screen.getByRole('button', { name: 'Save sync settings' }));

    expect(await screen.findByText('Sync settings saved')).toBeTruthy();
    expect(test.syncSettings.saves).toEqual([
      {
        serverUrl: 'https://webdav.yandex.ru',
        filePath: '/Apps/MovieWatchlist/movies.json',
        login: 'me@yandex.ru',
        password: 'top-secret-123',
      },
    ]);
    expect(field('App password').value).toBe('');
    expect(field('App password').placeholder).toBe('Saved. Leave empty to keep it');
    expect(document.body.textContent).not.toContain('top-secret-123');
    expect(document.body.innerHTML).not.toContain('top-secret-123');
  });

  it('keeps the stored password when only the path changes (no password in the call)', async () => {
    const user = userEvent.setup();
    const test = createTestServices({ sync: true });
    test.syncSettings.config = { ...test.syncSettings.config, login: 'me', hasPassword: true };
    await openSettings(test);
    await user.clear(field('File path on the server'));
    await user.type(field('File path on the server'), '/other/movies.json');
    await user.click(screen.getByRole('button', { name: 'Save sync settings' }));
    await screen.findByText('Sync settings saved');
    expect(test.syncSettings.saves).toHaveLength(1);
    expect(test.syncSettings.saves[0]).not.toHaveProperty('password');
    expect(test.syncSettings.saves[0]?.filePath).toBe('/other/movies.json');
  });

  it.each([
    ['login', 'File path on the server', null, 'Login', 'someone-else'],
    ['server', 'Server URL', 'https://dav.other.example', null, null],
  ] as const)(
    'asks for the password again when the %s changes',
    async (_name, label, value, label2, value2) => {
      const user = userEvent.setup();
      const test = createTestServices({ sync: true });
      test.syncSettings.config = { ...test.syncSettings.config, login: 'me', hasPassword: true };
      await openSettings(test);
      if (value) {
        await user.clear(field(label));
        await user.type(field(label), value);
      }
      if (label2 && value2) {
        await user.clear(field(label2));
        await user.type(field(label2), value2);
      }
      await user.click(screen.getByRole('button', { name: 'Save sync settings' }));
      expect((await screen.findByRole('alert')).textContent).toContain('Enter the password');
      expect(test.syncSettings.saves).toEqual([]);
    },
  );

  it.each([
    ['path without a leading slash', 'File path on the server', 'movies.json', 'must start with /'],
    ['path ending with a slash', 'File path on the server', '/folder/', 'must start with /'],
    ['empty login', 'Login', '', 'Enter your login'],
  ])('validates %s before calling the backend', async (_name, label, value, message) => {
    const user = userEvent.setup();
    const test = createTestServices({ sync: true });
    test.syncSettings.config = { ...test.syncSettings.config, login: 'me', hasPassword: true };
    await openSettings(test);
    await user.clear(field(label));
    if (value) await user.type(field(label), value);
    await user.click(screen.getByRole('button', { name: 'Save sync settings' }));
    expect((await screen.findByRole('alert')).textContent).toContain(message);
    expect(test.syncSettings.saves).toEqual([]);
  });

  it('shows a translated message when the main process rejects the settings', async () => {
    const user = userEvent.setup();
    const test = await openSettings();
    test.syncSettings.error = new ConfigError('Server URL must use https');
    await user.type(field('Login'), 'me');
    await user.type(field('App password'), 'pw');
    await user.click(screen.getByRole('button', { name: 'Save sync settings' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Sync is not set up correctly',
    );
  });

  it('forgets the password on request', async () => {
    const user = userEvent.setup();
    const test = createTestServices({ sync: true });
    test.syncSettings.config = { ...test.syncSettings.config, login: 'me', hasPassword: true };
    await openSettings(test);
    await user.click(screen.getByRole('button', { name: 'Forget password' }));
    expect(await screen.findByText('Password removed from this device')).toBeTruthy();
    expect(test.syncSettings.clears).toBe(1);
    expect(screen.queryByRole('button', { name: 'Forget password' })).toBeNull();
    expect(field('App password').placeholder).toBe('');
  });

  it('does not lose what the user typed when the language changes', async () => {
    const user = userEvent.setup();
    await openSettings();
    await user.type(field('Login'), 'half-typed');
    await i18n.changeLanguage('ru');
    await waitFor(() => expect(screen.getByLabelText('Логин')).toBeTruthy());
    expect((screen.getByLabelText('Логин') as HTMLInputElement).value).toBe('half-typed');
  });

  it('shows a translated error when the stored settings cannot be read', async () => {
    const test = createTestServices({ sync: true });
    test.syncSettings.error = new ConfigError('broken');
    renderApp(test, '#/settings');
    expect((await screen.findByText(/Sync is not set up correctly/)).textContent).toBeTruthy();
  });
});
