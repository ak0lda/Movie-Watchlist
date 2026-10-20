import type { CatalogItem } from '@movie-watchlist/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addTitle } from '../data/addEntry';
import { errorKey } from '../errors/errorKey';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { routeHref } from '../hooks/useHashRoute';
import { useServices, useSettings, useTmdbConfig } from '../services';
import { Icons } from './icons';
import { PosterImage } from './PosterImage';

type SearchOutcome = { requestKey: string } & (
  { kind: 'error'; key: string } | { kind: 'results'; items: CatalogItem[] }
);

export const SEARCH_DEBOUNCE_MS = 400;

interface SearchScreenProps {
  debounceMs?: number;
  /** Text to search for right away (a title shared from another app). */
  initialQuery?: string;
  /** A share arrived but contained no recognisable title. */
  shareNotFound?: boolean;
  /** What the other app actually sent, shown when no title could be found in it. */
  shareReceived?: string | undefined;
  /** A Kinopoisk film/series number to turn into a title (needs the API key and the Android app). */
  kinopoiskId?: number | undefined;
}

export function SearchScreen({
  debounceMs = SEARCH_DEBOUNCE_MS,
  initialQuery = '',
  shareNotFound = false,
  shareReceived,
  kinopoiskId,
}: SearchScreenProps) {
  const { t, i18n } = useTranslation();
  const services = useServices();
  const { repo, catalog } = services;
  const config = useTmdbConfig();
  const [text, setText] = useState(initialQuery);
  useDocumentTitle(t('search.title'));
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

  // Kinopoisk link -> title: runs once per link, and only fills an untouched search box.
  const kinopoiskKey = useSettings().kinopoiskKey.trim();
  const kinopoisk = services.kinopoisk;
  const [lookup, setLookup] = useState<{ id: number; errorKey?: string } | null>(null);
  const lookupWanted = kinopoiskId !== undefined && kinopoisk !== undefined && kinopoiskKey !== '';
  const lookupDone = lookup?.id === kinopoiskId ? lookup : null;
  const lookingUp = lookupWanted && lookupDone === null;

  useEffect(() => {
    if (!lookupWanted || !kinopoisk || kinopoiskId === undefined) return;
    let cancelled = false;
    kinopoisk.resolve(kinopoiskId, language).then(
      (title) => {
        if (cancelled) return;
        setText((current) => (current === '' ? title : current));
        setLookup({ id: kinopoiskId });
      },
      (error: unknown) => {
        if (!cancelled) setLookup({ id: kinopoiskId, errorKey: errorKey(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [lookupWanted, kinopoisk, kinopoiskId, language]);

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
    <section className="search-screen">
      <div className="screen-head">
        <h1>{t('search.title')}</h1>
      </div>
      <label className="search-field large">
        <Icons.search />
        <input
          type="search"
          aria-label={t('search.label')}
          placeholder={t('search.placeholder')}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>

      {kinopoiskId !== undefined && text === '' && (
        <div role="status" className="callout">
          <Icons.info />
          <div className="callout-body">
            {!kinopoisk && <p>{t('search.kinopoiskUnavailable')}</p>}
            {kinopoisk && kinopoiskKey === '' && (
              <p>
                {t('search.kinopoiskNeedsKey')}{' '}
                <a href={routeHref({ name: 'settings' })}>{t('nav.settings')}</a>
              </p>
            )}
            {lookingUp && <p>{t('search.kinopoiskLooking')}</p>}
            {shareReceived && (
              <p className="muted">{t('search.shareReceived', { text: shareReceived })}</p>
            )}
          </div>
        </div>
      )}
      {lookupDone?.errorKey && text === '' && (
        <p role="alert" className="callout callout-error">
          {t(lookupDone.errorKey)}
        </p>
      )}
      {shareNotFound && text === '' && (
        <div role="status" className="callout">
          <Icons.info />
          <div className="callout-body">
            <p>{t('search.shareNotFound')}</p>
            <p className="muted">
              {shareReceived
                ? t('search.shareReceived', { text: shareReceived })
                : t('search.shareNothing')}
            </p>
          </div>
        </div>
      )}
      {!hasKey && (
        <p role="alert" className="callout callout-error">
          <span>
            {t('search.keyMissing')}{' '}
            <a href={routeHref({ name: 'settings' })}>{t('nav.settings')}</a>
          </span>
        </p>
      )}
      {loading && <p className="loading">{t('common.loading')}</p>}
      {state?.kind === 'error' && (
        <p role="alert" className="callout callout-error">
          {t(state.key)}
        </p>
      )}
      {addErrorKey && (
        <p role="alert" className="callout callout-error">
          {t(addErrorKey)}
        </p>
      )}
      {state?.kind === 'results' && state.items.length === 0 && (
        <div className="empty">
          <span className="empty-icon">
            <Icons.search />
          </span>
          <p>{t('search.noResults')}</p>
        </div>
      )}
      {hasKey && text.trim() === '' && kinopoiskId === undefined && !shareNotFound && (
        <div className="empty">
          <span className="empty-icon">
            <Icons.film />
          </span>
          <p>{t('search.hint')}</p>
        </div>
      )}
      {state?.kind === 'results' && state.items.length > 0 && (
        <ul className="items rows">
          {state.items.map((item) => {
            const id = `${item.mediaType}:${item.tmdbId}`;
            return (
              <li key={id} className="row-item">
                <PosterImage posterPath={item.posterPath} title={item.title} />
                <span className="row-main">
                  <a
                    href={routeHref({
                      name: 'title',
                      mediaType: item.mediaType,
                      tmdbId: item.tmdbId,
                    })}
                  >
                    <strong>{item.title}</strong>
                  </a>
                  <span className="muted">
                    {item.year !== undefined && <>{item.year} · </>}
                    {t(`mediaType.${item.mediaType}`)}
                  </span>
                </span>
                {listed?.has(id) ? (
                  <span className="in-list">
                    <Icons.check />
                    {t('search.inList')}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    aria-label={t('search.add')}
                    disabled={addingId === id}
                    onClick={() => void handleAdd(item)}
                  >
                    <Icons.plus />
                    <span className="btn-label">{t('search.add')}</span>
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
