// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import i18n from '../i18n';
import { ServicesProvider } from '../services';
import { KinopoiskError, type KinopoiskResolver } from '../share/kinopoisk';
import { startShareHandling, type ShareEvent, type ShareTargetPlugin } from '../share/shareService';
import { createTestServices, makeItem } from '../testing/helpers';

type TestServices = ReturnType<typeof createTestServices>;

class FakeKinopoisk implements KinopoiskResolver {
  calls: { id: number; language: string }[] = [];
  title = 'Дюна';
  error: Error | undefined;
  gate: Promise<void> | undefined;

  async resolve(id: number, language: string): Promise<string> {
    this.calls.push({ id, language });
    await this.gate;
    if (this.error) throw this.error;
    return this.title;
  }
}

const LINK = 'https://www.kinopoisk.ru/film/535341/?socialAlias=MTg2OTg3MDE%3D';
const SHARE_ROUTE = `#/search?kp=535341&got=${encodeURIComponent(LINK)}`;

function renderApp(test: TestServices, hash: string) {
  window.location.hash = hash;
  return render(
    <ServicesProvider value={test.services}>
      <App />
    </ServicesProvider>,
  );
}

const searchBox = () => screen.getByLabelText('Search movies and series') as HTMLInputElement;

async function navigate(hash: string) {
  await act(async () => {
    window.location.hash = hash;
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});
afterEach(() => cleanup());

describe('shared Kinopoisk link: title lookup', () => {
  it('looks the number up, fills the search box and runs the TMDB search with the title', async () => {
    const kp = new FakeKinopoisk();
    const test = createTestServices({ tmdbKey: 'tmdb', kinopoiskKey: 'kp-key', kinopoisk: kp });
    test.catalog.searchResults = [makeItem({ title: 'Дюна' })];
    renderApp(test, SHARE_ROUTE);

    await waitFor(() => expect(searchBox().value).toBe('Дюна'));
    expect(kp.calls).toEqual([{ id: 535341, language: 'en' }]);
    await waitFor(() =>
      expect(test.catalog.searchCalls.at(-1)).toEqual({ query: 'Дюна', language: 'en' }),
    );
    expect(await screen.findByText('Дюна', { selector: 'strong' })).toBeTruthy();
  });

  it('passes the UI language so the right title is chosen', async () => {
    await i18n.changeLanguage('ru');
    const kp = new FakeKinopoisk();
    renderApp(createTestServices({ tmdbKey: 't', kinopoiskKey: 'k', kinopoisk: kp }), SHARE_ROUTE);
    await waitFor(() => expect(kp.calls).toEqual([{ id: 535341, language: 'ru' }]));
  });

  it('shows progress while the lookup is running', async () => {
    const kp = new FakeKinopoisk();
    let release!: () => void;
    kp.gate = new Promise<void>((resolve) => (release = resolve));
    renderApp(createTestServices({ tmdbKey: 't', kinopoiskKey: 'k', kinopoisk: kp }), SHARE_ROUTE);
    expect(await screen.findByText('Looking up the title on Kinopoisk…')).toBeTruthy();
    expect(searchBox().value).toBe('');
    release();
    await waitFor(() => expect(searchBox().value).toBe('Дюна'));
    expect(screen.queryByText('Looking up the title on Kinopoisk…')).toBeNull();
  });

  it('does not overwrite what the user typed while the lookup was running', async () => {
    const user = userEvent.setup();
    const kp = new FakeKinopoisk();
    let release!: () => void;
    kp.gate = new Promise<void>((resolve) => (release = resolve));
    renderApp(createTestServices({ tmdbKey: 't', kinopoiskKey: 'k', kinopoisk: kp }), SHARE_ROUTE);
    await user.type(searchBox(), 'Матрица');
    release();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(searchBox().value).toBe('Матрица');
  });

  it('looks up again when another Kinopoisk link is shared while search is open', async () => {
    const kp = new FakeKinopoisk();
    const test = createTestServices({ tmdbKey: 't', kinopoiskKey: 'k', kinopoisk: kp });
    renderApp(test, SHARE_ROUTE);
    await waitFor(() => expect(searchBox().value).toBe('Дюна'));
    kp.title = 'Интерстеллар';
    await navigate('#/search?kp=157336');
    await waitFor(() => expect(searchBox().value).toBe('Интерстеллар'));
    expect(kp.calls.map((call) => call.id)).toEqual([535341, 157336]);
  });

  it('asks for the key (and shows the link) when none is set, without calling the service', () => {
    const kp = new FakeKinopoisk();
    renderApp(createTestServices({ tmdbKey: 't', kinopoisk: kp }), SHARE_ROUTE);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('This is a Kinopoisk link');
    expect(status.textContent).toContain('Received: ' + LINK);
    expect(within(status).getByRole('link', { name: 'Settings' })).toBeTruthy();
    expect(kp.calls).toEqual([]);
    expect(searchBox().value).toBe('');
  });

  it('says it is Android-only when the platform has no resolver', () => {
    renderApp(createTestServices({ tmdbKey: 't', kinopoiskKey: 'k' }), SHARE_ROUTE);
    expect(screen.getByRole('status').textContent).toContain('works only in the Android app');
  });

  it.each([
    ['no-key', 'Add a Kinopoisk API key in Settings'],
    ['auth', 'Kinopoisk rejected the API key'],
    ['not-found', 'Kinopoisk has no title for this link'],
    ['rate-limited', 'request limit is used up'],
    ['network', 'Could not reach Kinopoisk'],
  ] as const)(
    'shows a translated message for a %s failure and leaves the box empty',
    async (code, text) => {
      const kp = new FakeKinopoisk();
      kp.error = new KinopoiskError(code, 'details that must not be shown: kp-secret');
      renderApp(
        createTestServices({ tmdbKey: 't', kinopoiskKey: 'kp-secret', kinopoisk: kp }),
        SHARE_ROUTE,
      );
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain(text);
      expect(document.body.textContent).not.toContain('kp-secret');
      expect(searchBox().value).toBe('');
    },
  );

  it('shows the failure in Russian', async () => {
    await i18n.changeLanguage('ru');
    const kp = new FakeKinopoisk();
    kp.error = new KinopoiskError('auth', 'x');
    renderApp(createTestServices({ tmdbKey: 't', kinopoiskKey: 'k', kinopoisk: kp }), SHARE_ROUTE);
    expect((await screen.findByRole('alert')).textContent).toContain('Кинопоиск отклонил ключ API');
  });

  it('a normal share is unaffected (no lookup)', async () => {
    const kp = new FakeKinopoisk();
    const test = createTestServices({ tmdbKey: 't', kinopoiskKey: 'k', kinopoisk: kp });
    renderApp(test, '#/search?q=Dune');
    expect(searchBox().value).toBe('Dune');
    await waitFor(() => expect(test.catalog.searchCalls).toHaveLength(1));
    expect(kp.calls).toEqual([]);
  });
});

describe('Kinopoisk key in settings', () => {
  const keyField = () => screen.getByLabelText('Kinopoisk API key (optional)') as HTMLInputElement;

  it('is offered only when the platform can look titles up', () => {
    renderApp(createTestServices(), '#/settings');
    expect(screen.queryByLabelText('Kinopoisk API key (optional)')).toBeNull();
    cleanup();
    renderApp(createTestServices({ kinopoisk: new FakeKinopoisk() }), '#/settings');
    expect(keyField().type).toBe('password');
  });

  it('saves the key without losing the TMDB key, and the TMDB form keeps the Kinopoisk key', async () => {
    const user = userEvent.setup();
    const test = createTestServices({ tmdbKey: 'tmdb-key', kinopoisk: new FakeKinopoisk() });
    renderApp(test, '#/settings');

    await user.type(keyField(), '  kp-key  ');
    await user.click(screen.getByRole('button', { name: 'Save Kinopoisk key' }));
    expect(test.settings.get()).toMatchObject({ tmdbKey: 'tmdb-key', kinopoiskKey: 'kp-key' });

    const tmdb = screen.getByLabelText('TMDB API key or read access token') as HTMLInputElement;
    await user.clear(tmdb);
    await user.type(tmdb, 'new-tmdb');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(test.settings.get()).toMatchObject({ tmdbKey: 'new-tmdb', kinopoiskKey: 'kp-key' });
  });

  it('shows the stored key as hidden text and explains what it is for', () => {
    renderApp(
      createTestServices({ kinopoiskKey: 'kp-key', kinopoisk: new FakeKinopoisk() }),
      '#/settings',
    );
    expect(keyField().value).toBe('kp-key');
    expect(screen.getByText(/kinopoiskapiunofficial\.tech/)).toBeTruthy();
  });
});

describe('Android share of a Kinopoisk link, end to end', () => {
  class FakePlugin implements ShareTargetPlugin {
    private listener: ((event: ShareEvent) => void) | undefined;
    addListener(_event: 'shareReceived', listener: (event: ShareEvent) => void) {
      this.listener = listener;
      return Promise.resolve({ remove: () => Promise.resolve() });
    }
    share(event: ShareEvent) {
      this.listener?.(event);
    }
  }

  it('Share of only the Kinopoisk link finds the title and searches TMDB for it', async () => {
    const kp = new FakeKinopoisk();
    kp.title = 'Бойцовский клуб';
    const test = createTestServices({ tmdbKey: 't', kinopoiskKey: 'k', kinopoisk: kp });
    renderApp(test, '#/');
    const plugin = new FakePlugin();
    startShareHandling(plugin, (href) => {
      window.location.hash = href;
    });
    await act(async () => {
      plugin.share({ text: LINK });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await waitFor(() => expect(searchBox().value).toBe('Бойцовский клуб'));
    await waitFor(() =>
      expect(test.catalog.searchCalls.at(-1)).toEqual({ query: 'Бойцовский клуб', language: 'en' }),
    );
    expect(kp.calls[0]?.id).toBe(535341);
  });
});
