// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import i18n from '../i18n';
import { ServicesProvider } from '../services';
import { startShareHandling, type ShareTargetPlugin } from '../share/shareService';
import { createTestServices, makeItem } from '../testing/helpers';

type TestServices = ReturnType<typeof createTestServices>;

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
    // jsdom dispatches hashchange asynchronously.
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('en');
});
afterEach(() => cleanup());

describe('search opened from a share', () => {
  it('fills the box and searches immediately, without typing', async () => {
    const test = createTestServices({ tmdbKey: 'k' });
    test.catalog.searchResults = [makeItem()];
    renderApp(test, '#/search?q=Dune');
    expect(searchBox().value).toBe('Dune');
    expect(await screen.findByText('Dune', { selector: 'strong' })).toBeTruthy();
    expect(test.catalog.searchCalls).toEqual([{ query: 'Dune', language: 'en' }]);
  });

  it('decodes non-ASCII and special characters from the route', async () => {
    const test = createTestServices({ tmdbKey: 'k' });
    renderApp(test, `#/search?q=${encodeURIComponent('Дюна: Часть вторая & «ещё»')}`);
    expect(searchBox().value).toBe('Дюна: Часть вторая & «ещё»');
    await waitFor(() => expect(test.catalog.searchCalls).toHaveLength(1));
  });

  it('replaces the text when another share arrives while search is already open', async () => {
    const user = userEvent.setup();
    const test = createTestServices({ tmdbKey: 'k' });
    renderApp(test, '#/search?q=Dune');
    await waitFor(() => expect(test.catalog.searchCalls).toHaveLength(1));
    await user.clear(searchBox());
    await user.type(searchBox(), 'something typed by hand');

    await navigate('#/search?q=Matrix');
    await waitFor(() => expect(searchBox().value).toBe('Matrix'));
    await waitFor(() =>
      expect(test.catalog.searchCalls.map((call) => call.query)).toContain('Matrix'),
    );
  });

  it('keeps the query and explains the missing key when TMDB is not configured', () => {
    const test = createTestServices();
    renderApp(test, '#/search?q=Dune');
    expect(searchBox().value).toBe('Dune');
    expect(screen.getByRole('alert').textContent).toContain('TMDB API key is required');
    expect(test.catalog.searchCalls).toEqual([]);
  });

  it('shows a hint when the share had no recognisable title, and hides it once the user types', async () => {
    const user = userEvent.setup();
    const test = createTestServices({ tmdbKey: 'k' });
    renderApp(test, '#/search?notFound=1');
    expect(searchBox().value).toBe('');
    expect(screen.getByRole('status').textContent).toContain('Could not find a title');
    expect(test.catalog.searchCalls).toEqual([]);

    await user.type(searchBox(), 'D');
    expect(screen.queryByText(/Could not find a title/)).toBeNull();
  });

  it('shows the hint in Russian', async () => {
    await i18n.changeLanguage('ru');
    renderApp(createTestServices({ tmdbKey: 'k' }), '#/search?notFound=1');
    expect(screen.getByRole('status').textContent).toContain('не удалось найти название');
  });

  it('a plain #/search stays empty with no hint', () => {
    renderApp(createTestServices({ tmdbKey: 'k' }), '#/search');
    expect(searchBox().value).toBe('');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not treat the query as markup', () => {
    renderApp(
      createTestServices({ tmdbKey: 'k' }),
      `#/search?q=${encodeURIComponent('<img src=x onerror=alert(1)>')}`,
    );
    expect(searchBox().value).toBe('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});

describe('share -> route -> UI, end to end', () => {
  class FakePlugin implements ShareTargetPlugin {
    private listener: ((event: { text?: unknown }) => void) | undefined;
    addListener(_event: 'shareReceived', listener: (event: { text?: unknown }) => void) {
      this.listener = listener;
      return Promise.resolve({ remove: () => Promise.resolve() });
    }
    share(text: string) {
      this.listener?.({ text });
    }
  }

  it('Share "Смотри Дюна <link>" opens the search with "Дюна" and runs it', async () => {
    const test = createTestServices({ tmdbKey: 'k' });
    test.catalog.searchResults = [makeItem({ title: 'Дюна' })];
    renderApp(test, '#/');
    const plugin = new FakePlugin();
    startShareHandling(plugin, (href) => {
      window.location.hash = href;
    });
    await act(async () => {
      plugin.share('Смотри Дюна https://www.kinopoisk.ru/film/409424/');
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await waitFor(() => expect(searchBox().value).toBe('Дюна'));
    await waitFor(() =>
      expect(test.catalog.searchCalls.at(-1)).toEqual({ query: 'Дюна', language: 'en' }),
    );
  });

  it('a share with only a link opens an empty search with the hint', async () => {
    const test = createTestServices({ tmdbKey: 'k' });
    renderApp(test, '#/');
    const plugin = new FakePlugin();
    startShareHandling(plugin, (href) => {
      window.location.hash = href;
    });
    await act(async () => {
      plugin.share('https://www.kinopoisk.ru/film/409424/');
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Could not find a title'),
    );
    expect(test.catalog.searchCalls).toEqual([]);
  });
});
