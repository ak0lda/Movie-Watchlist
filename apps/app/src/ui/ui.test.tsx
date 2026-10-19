// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../App';
import i18n from '../i18n';
import { LANGUAGE_STORAGE_KEY } from '../i18n/resolveLanguage';
import { ServicesProvider } from '../services';
import { createTestServices, makeDetails, makeItem } from '../testing/helpers';
import { SearchScreen } from './SearchScreen';

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

const ATTRIBUTION = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

describe('shell', () => {
  it('shows the TMDB attribution on every screen', () => {
    renderApp(createTestServices());
    expect(screen.getByText(ATTRIBUTION)).toBeTruthy();
    cleanup();
    renderApp(createTestServices(), '#/settings');
    expect(screen.getByText(ATTRIBUTION)).toBeTruthy();
  });

  it('switches the language from settings and remembers the choice', async () => {
    const user = userEvent.setup();
    renderApp(createTestServices(), '#/settings');
    await user.selectOptions(screen.getByLabelText('Language'), 'ru');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Настройки' })).toBeTruthy());
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ru');
    expect(document.documentElement.lang).toBe('ru');
    expect(screen.getByText(ATTRIBUTION)).toBeTruthy();
  });
});

describe('search', () => {
  it('asks for an API key instead of searching when none is configured', async () => {
    const user = userEvent.setup();
    const test = createTestServices();
    render(
      <ServicesProvider value={test.services}>
        <SearchScreen debounceMs={10} />
      </ServicesProvider>,
    );
    await user.type(screen.getByLabelText('Search movies and series'), 'dune');
    expect(screen.getByRole('alert').textContent).toContain('TMDB API key is required');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(test.catalog.searchCalls).toEqual([]);
  });

  it('debounces typing into a single request in the UI language', async () => {
    const user = userEvent.setup();
    const test = createTestServices({ tmdbKey: 'k' });
    test.catalog.searchResults = [makeItem()];
    render(
      <ServicesProvider value={test.services}>
        <SearchScreen debounceMs={150} />
      </ServicesProvider>,
    );
    await user.type(screen.getByLabelText('Search movies and series'), 'dune');
    await screen.findByText('Dune');
    expect(test.catalog.searchCalls).toEqual([{ query: 'dune', language: 'en' }]);
  });

  it('shows a translated error when the catalog fails', async () => {
    const { CatalogError } = await import('@movie-watchlist/core');
    const user = userEvent.setup();
    const test = createTestServices({ tmdbKey: 'k' });
    test.catalog.searchError = new CatalogError('rate-limited', '');
    render(
      <ServicesProvider value={test.services}>
        <SearchScreen debounceMs={10} />
      </ServicesProvider>,
    );
    await user.type(screen.getByLabelText('Search movies and series'), 'dune');
    expect((await screen.findByRole('alert')).textContent).toContain('rate limiting');
  });

  it('adds a result to the list and then marks it as listed', async () => {
    const user = userEvent.setup();
    const test = createTestServices({ tmdbKey: 'k' });
    test.catalog.searchResults = [makeItem()];
    test.catalog.details.set('movie:438631', makeDetails({ genres: ['Drama'] }));
    render(
      <ServicesProvider value={test.services}>
        <SearchScreen debounceMs={10} />
      </ServicesProvider>,
    );
    await user.type(screen.getByLabelText('Search movies and series'), 'dune');
    await user.click(await screen.findByRole('button', { name: 'Add to list' }));
    await screen.findByText('In your list');
    expect((await test.services.repo.get('movie:438631'))?.genres).toEqual(['Drama']);
  });
});

describe('list', () => {
  async function seeded() {
    const test = createTestServices();
    await test.services.repo.add(makeItem({ tmdbId: 1, title: 'Alpha' }));
    await test.services.repo.add(makeItem({ tmdbId: 2, title: 'Beta' }));
    await test.services.repo.add(makeItem({ tmdbId: 3, title: 'Gamma' }));
    await test.services.repo.update('movie:2', { status: 'watched', rating: 9, source: 'Vasya' });
    await test.services.repo.remove('movie:3');
    return test;
  }

  it('shows live entries only, with status and rating', async () => {
    renderApp(await seeded());
    expect(await screen.findByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.queryByText('Gamma')).toBeNull();
    expect(screen.getByText('★ 9', { exact: false })).toBeTruthy();
  });

  it('filters by status and by search text', async () => {
    const user = userEvent.setup();
    renderApp(await seeded());
    await screen.findByText('Alpha');

    await user.selectOptions(screen.getByLabelText('Filter by status'), 'watched');
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('Beta')).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('Filter by status'), 'all');
    await user.type(screen.getByLabelText('Search the list'), 'vasya');
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('Beta')).toBeTruthy();

    await user.clear(screen.getByLabelText('Search the list'));
    await user.type(screen.getByLabelText('Search the list'), 'zzz');
    expect(screen.getByText('Nothing matches the current filters.')).toBeTruthy();
  });

  it('sorts by title', async () => {
    const user = userEvent.setup();
    renderApp(await seeded());
    await screen.findByText('Alpha');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'rating');
    const titles = within(screen.getByRole('list'))
      .getAllByRole('listitem')
      .map((item) => item.querySelector('strong')?.textContent);
    expect(titles).toEqual(['Beta', 'Alpha']);
  });

  it('shows the empty state', async () => {
    renderApp(createTestServices());
    expect(await screen.findByText(/Your list is empty/)).toBeTruthy();
  });
});

describe('details', () => {
  it('adds from cached details, edits the entry and removes it', async () => {
    const user = userEvent.setup();
    const test = createTestServices();
    await test.services.metaCache.put(makeDetails({ genres: ['Drama'] }), 'en');
    renderApp(test, '#/title/movie/438631');

    expect(await screen.findByRole('heading', { name: 'Dune' })).toBeTruthy();
    expect(screen.getByText('Drama')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add to list' }));

    await user.selectOptions(await screen.findByLabelText('Status'), 'watched');
    await user.selectOptions(screen.getByLabelText('Your rating'), '8');
    await user.type(screen.getByLabelText('Recommended by'), 'Vasya');
    await user.type(screen.getByLabelText('Note'), 'Great visuals');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved');
    expect(await test.services.repo.get('movie:438631')).toMatchObject({
      status: 'watched',
      rating: 8,
      source: 'Vasya',
      note: 'Great visuals',
    });

    await user.click(screen.getByRole('button', { name: 'Remove from list' }));
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }));
    await screen.findByRole('button', { name: 'Add to list' });
    expect((await test.services.repo.get('movie:438631'))?.deleted).toBe(true);
  });

  it('falls back to the saved copy when TMDB is unreachable', async () => {
    const { CatalogError } = await import('@movie-watchlist/core');
    const test = createTestServices({ tmdbKey: 'k' });
    await test.services.repo.add(makeItem({ title: 'Saved title' }), ['Drama']);
    test.catalog.detailsError = new CatalogError('network', '');
    renderApp(test, '#/title/movie/438631');
    expect(await screen.findByRole('heading', { name: 'Saved title' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Showing the saved copy/)).toBeTruthy());
  });

  it('explains the missing key when there is neither cache nor saved copy', async () => {
    renderApp(createTestServices(), '#/title/movie/1');
    expect((await screen.findByRole('alert')).textContent).toContain('API key');
  });
});
