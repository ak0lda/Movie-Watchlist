import type { WatchStatus } from '@movie-watchlist/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { routeHref } from '../hooks/useHashRoute';
import { useListScrollMemory } from '../hooks/useScrollMemory';
import {
  DEFAULT_LIST_QUERY,
  applyListQuery,
  type SortKey,
  type StatusFilter,
} from '../list/listView';
import { useServices } from '../services';
import { Icons } from './icons';
import { PosterImage } from './PosterImage';

const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'want', 'watching', 'watched'];
const SORT_KEYS: readonly SortKey[] = ['addedAt', 'title', 'rating'];

/** Two-digit running number shown above each card title ("01", "02", ...). */
function indexLabel(index: number): string {
  return String(index + 1).padStart(2, '0');
}

export function ListScreen() {
  const { t, i18n } = useTranslation();
  const { repo } = useServices();
  const entries = useLiveQuery(() => repo.getAll(), [repo]);
  const [query, setQuery] = useState(DEFAULT_LIST_QUERY);
  useDocumentTitle(t('list.title'));
  useListScrollMemory(entries !== undefined);

  if (entries === undefined) return <p className="loading">{t('common.loading')}</p>;

  const visible = applyListQuery(entries, query, i18n.language);
  const liveCount = entries.filter((entry) => !entry.deleted).length;

  return (
    <section>
      <div className="screen-head">
        <h1>{t('list.title')}</h1>
        {liveCount > 0 && <span className="muted">{t('list.count', { count: liveCount })}</span>}
      </div>

      {liveCount === 0 ? (
        <div className="empty">
          <span className="empty-icon">
            <Icons.film />
          </span>
          <p>{t('list.empty')}</p>
          <a className="btn btn-primary" href={routeHref({ name: 'search' })}>
            <Icons.search />
            {t('list.emptyAction')}
          </a>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <label className="search-field">
              <Icons.search />
              <input
                type="search"
                aria-label={t('list.searchLabel')}
                placeholder={t('list.searchPlaceholder')}
                value={query.search}
                onChange={(event) => setQuery({ ...query, search: event.target.value })}
              />
            </label>
            <div className="toolbar-row">
              <div className="chips" role="group" aria-label={t('list.filterLabel')}>
                {STATUS_FILTERS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="chip"
                    aria-pressed={query.status === value}
                    onClick={() => setQuery({ ...query, status: value })}
                  >
                    {value === 'all'
                      ? t('list.filterAll')
                      : t(`status.${value satisfies WatchStatus}`)}
                  </button>
                ))}
              </div>
              <select
                className="sort"
                aria-label={t('list.sortLabel')}
                value={query.sort}
                onChange={(event) => setQuery({ ...query, sort: event.target.value as SortKey })}
              >
                {SORT_KEYS.map((value) => (
                  <option key={value} value={value}>
                    {t(`list.sort.${value}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {visible.length === 0 ? (
            <div className="empty">
              <span className="empty-icon">
                <Icons.search />
              </span>
              <p>{t('list.emptyFiltered')}</p>
              <button
                type="button"
                onClick={() => setQuery({ ...DEFAULT_LIST_QUERY, sort: query.sort })}
              >
                {t('list.resetFilters')}
              </button>
            </div>
          ) : (
            <ul className="items grid">
              {visible.map((entry, index) => (
                <li key={entry.id}>
                  <a
                    className="card"
                    href={routeHref({
                      name: 'title',
                      mediaType: entry.mediaType,
                      tmdbId: entry.tmdbId,
                    })}
                  >
                    <span className="card-poster">
                      <PosterImage posterPath={entry.posterPath} title={entry.title} />
                      {entry.rating !== undefined && (
                        <span className="rating">
                          {t('list.ratingBadge', { rating: entry.rating })}
                        </span>
                      )}
                    </span>
                    <span className="card-body">
                      <span className="card-index">{indexLabel(index)}</span>
                      <strong>{entry.title}</strong>
                      <span className="muted">
                        {entry.year !== undefined && <>{entry.year} · </>}
                        {t(`mediaType.${entry.mediaType}`)}
                      </span>
                      <span className={`status status-${entry.status}`}>
                        {t(`status.${entry.status}`)}
                      </span>
                      {entry.source && (
                        <span className="muted">
                          {t('list.sourceBadge', { source: entry.source })}
                        </span>
                      )}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
