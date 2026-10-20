import {
  entryId,
  type CatalogDetails,
  type MediaType,
  type MovieEntry,
} from '@movie-watchlist/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addTitle } from '../data/addEntry';
import type { EntryPatch } from '../data/repository';
import { errorKey } from '../errors/errorKey';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { routeHref } from '../hooks/useHashRoute';
import { useServices, useTmdbConfig } from '../services';
import { EntryEditor } from './EntryEditor';
import { Icons } from './icons';
import { PosterImage } from './PosterImage';

/** The offline backup copy stored with the entry, shaped like fresh catalog details. */
function detailsFromEntry(entry: MovieEntry): CatalogDetails {
  const details: CatalogDetails = {
    mediaType: entry.mediaType,
    tmdbId: entry.tmdbId,
    title: entry.title,
    originalTitle: entry.originalTitle,
    overview: entry.overview,
    genres: entry.genres,
  };
  if (entry.year !== undefined) details.year = entry.year;
  if (entry.posterPath !== undefined) details.posterPath = entry.posterPath;
  if (entry.tmdbRating !== undefined) details.tmdbRating = entry.tmdbRating;
  return details;
}

interface DetailsScreenProps {
  mediaType: MediaType;
  tmdbId: number;
}

export function DetailsScreen({ mediaType, tmdbId }: DetailsScreenProps) {
  const { t, i18n } = useTranslation();
  const services = useServices();
  const { repo, catalog, metaCache } = services;
  const config = useTmdbConfig();
  const id = entryId(mediaType, tmdbId);
  const language = i18n.language;
  const hasKey = config.apiKey !== '';

  // null = not in the list, undefined = still loading.
  const entry = useLiveQuery(async () => (await repo.get(id)) ?? null, [repo, id]);
  // Loaded data is tagged with the (title, language) it belongs to, so stale values are ignored.
  const loadKey = `${id}:${language}`;
  const [loaded, setLoaded] = useState<{ loadKey: string; details: CatalogDetails } | null>(null);
  const [loadError, setLoadError] = useState<{ loadKey: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fresh = loaded?.loadKey === loadKey ? loaded.details : null;
  const loadErrorKey = loadError?.loadKey === loadKey ? loadError.key : null;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    void (async () => {
      const cached = await metaCache.get(mediaType, tmdbId, language);
      if (cancelled) return;
      if (cached) setLoaded({ loadKey, details: cached.details });
      if (cached && !cached.stale) return;
      if (!hasKey) {
        if (!cached) setLoadError({ loadKey, key: 'errors.catalog.auth' });
        return;
      }
      try {
        const details = await catalog.getDetails(mediaType, tmdbId, language, controller.signal);
        await metaCache.put(details, language);
        if (cancelled) return;
        setLoaded({ loadKey, details });
        setLoadError(null);
        void repo.completeMetadata(id, details);
      } catch (error) {
        if (!cancelled && !controller.signal.aborted) {
          setLoadError({ loadKey, key: errorKey(error) });
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [catalog, metaCache, repo, id, loadKey, mediaType, tmdbId, language, hasKey]);

  const live = entry && !entry.deleted ? entry : null;
  const view = fresh ?? (entry ? detailsFromEntry(entry) : null);
  useDocumentTitle(view?.title);

  async function handleAdd() {
    if (!view) return;
    setBusy(true);
    try {
      await addTitle(services, view, language);
    } finally {
      setBusy(false);
    }
  }

  const backLink = (
    <a className="btn btn-sm back" href={routeHref({ name: 'list' })}>
      <Icons.back />
      {t('details.back')}
    </a>
  );

  if (entry === undefined) return <p className="loading">{t('common.loading')}</p>;
  if (!view) {
    return (
      <section>
        {backLink}
        <p
          role={loadErrorKey ? 'alert' : undefined}
          className={loadErrorKey ? 'callout callout-error' : 'loading'}
        >
          {loadErrorKey ? t(loadErrorKey) : t('common.loading')}
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="hero">
        {backLink}
        <div className="details">
          <PosterImage posterPath={view.posterPath} title={view.title} />
          <div className="details-info">
            <h1>{view.title}</h1>
            {view.originalTitle !== view.title && <p className="muted">{view.originalTitle}</p>}
            <div className="meta">
              <span className="tag">{t(`mediaType.${view.mediaType}`)}</span>
              {view.year !== undefined && <span className="tag">{view.year}</span>}
              {view.tmdbRating !== undefined && (
                <span className="tag tag-accent">
                  {t('details.tmdbRating')} {view.tmdbRating.toFixed(1)}
                </span>
              )}
            </div>
            {view.genres.length > 0 && <p className="muted">{view.genres.join(', ')}</p>}
            {!live && (
              <div className="details-actions">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => void handleAdd()}
                >
                  <Icons.plus />
                  {t('details.add')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="details-body">
        <div className="details-text">
          {view.overview && <p className="overview">{view.overview}</p>}
          {loadErrorKey && (
            <p role="alert" className="muted">
              {t(loadErrorKey)} {t('details.savedCopy')}
            </p>
          )}
        </div>
        {live && (
          <div className="panel">
            <EntryEditor
              key={live.id}
              entry={live}
              onSave={(patch: EntryPatch) => repo.update(live.id, patch)}
              onRemove={() => repo.remove(live.id)}
            />
          </div>
        )}
      </div>
    </section>
  );
}
