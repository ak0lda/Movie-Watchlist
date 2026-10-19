import type { CatalogItem } from '@movie-watchlist/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addTitle } from '../data/addEntry';
import { errorKey } from '../errors/errorKey';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { routeHref } from '../hooks/useHashRoute';
import { useServices, useTmdbConfig } from '../services';
import { PosterImage } from './PosterImage';

type SearchOutcome = { requestKey: string } & (
  { kind: 'error'; key: string } | { kind: 'results'; items: CatalogItem[] }
);

export const SEARCH_DEBOUNCE_MS = 400;

export function SearchScreen({ debounceMs = SEARCH_DEBOUNCE_MS }: { debounceMs?: number }) {
  const { t, i18n } = useTranslation();
  const services = useServices();
  const { repo, catalog } = services;
  const config = useTmdbConfig();
  const [text, setText] = useState('');
  const debounced = useDebouncedValue(text.trim(), debounceMs);
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addErrorKey, setAddErrorKey] = useState<string | null>(null);
  const listed = useLiveQuery(async () => {
    const all = await repo.getAll();
    return new Set(all.filter((entry) => !entry.deleted).map((entry) => entry.id));
  }, [repo]);
  const language = i18n.language;
  const hasKey = config.apiKey !== '';

  // Idle/loading are derived: an outcome only counts if it belongs to the current request.
  const searching = debounced !== '' && hasKey;
  const requestKey = `${language}:${debounced}`;
  const state: SearchOutcome | null =
    searching && outcome?.requestKey === requestKey ? outcome : null;
  const loading = searching && state === null;

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    catalog
      .search(debounced, language, controller.signal)
      .then((items) => setOutcome({ requestKey, kind: 'results', items }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setOutcome({ requestKey, kind: 'error', key: errorKey(error) });
      });
    return () => controller.abort();
  }, [searching, debounced, language, requestKey, catalog]);

  async function handleAdd(item: CatalogItem) {
    setAddingId(`${item.mediaType}:${item.tmdbId}`);
    setAddErrorKey(null);
    try {
      await addTitle(services, item, language);
    } catch (error) {
      setAddErrorKey(errorKey(error));
    } finally {
      setAddingId(null);
    }
  }

  return (
    <section>
      <h1>{t('search.title')}</h1>
      <input
        type="search"
        aria-label={t('search.label')}
        placeholder={t('search.placeholder')}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />

      {!hasKey && (
        <p role="alert">
          {t('search.keyMissing')} <a href={routeHref({ name: 'settings' })}>{t('nav.settings')}</a>
        </p>
      )}
      {loading && <p>{t('common.loading')}</p>}
      {state?.kind === 'error' && <p role="alert">{t(state.key)}</p>}
      {addErrorKey && <p role="alert">{t(addErrorKey)}</p>}
      {state?.kind === 'results' && state.items.length === 0 && <p>{t('search.noResults')}</p>}
      {state?.kind === 'results' && state.items.length > 0 && (
        <ul className="items">
          {state.items.map((item) => {
            const id = `${item.mediaType}:${item.tmdbId}`;
            return (
              <li key={id} className="item">
                <PosterImage posterPath={item.posterPath} title={item.title} />
                <span className="item-main">
                  <a
                    href={routeHref({
                      name: 'title',
                      mediaType: item.mediaType,
                      tmdbId: item.tmdbId,
                    })}
                  >
                    <strong>{item.title}</strong>
                  </a>
                  {item.year !== undefined && <span className="muted">{item.year}</span>}
                  <span className="muted">{t(`mediaType.${item.mediaType}`)}</span>
                </span>
                {listed?.has(id) ? (
                  <span className="muted">{t('search.inList')}</span>
                ) : (
                  <button
                    type="button"
                    disabled={addingId === id}
                    onClick={() => void handleAdd(item)}
                  >
                    {t('search.add')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
