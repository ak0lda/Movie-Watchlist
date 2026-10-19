import type { WatchStatus } from '@movie-watchlist/core';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { routeHref } from '../hooks/useHashRoute';
import {
  DEFAULT_LIST_QUERY,
  applyListQuery,
  type SortKey,
  type StatusFilter,
} from '../list/listView';
import { useServices } from '../services';
import { PosterImage } from './PosterImage';

const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'want', 'watching', 'watched'];
const SORT_KEYS: readonly SortKey[] = ['addedAt', 'title', 'rating'];

export function ListScreen() {
  const { t, i18n } = useTranslation();
  const { repo } = useServices();
  const entries = useLiveQuery(() => repo.getAll(), [repo]);
  const [query, setQuery] = useState(DEFAULT_LIST_QUERY);

  if (entries === undefined) return <p>{t('common.loading')}</p>;

  const visible = applyListQuery(entries, query, i18n.language);
  const hasEntries = entries.some((entry) => !entry.deleted);

  return (
    <section>
      <h1>{t('list.title')}</h1>
      <div className="toolbar">
        <input
          type="search"
          aria-label={t('list.searchLabel')}
          placeholder={t('list.searchPlaceholder')}
          value={query.search}
          onChange={(event) => setQuery({ ...query, search: event.target.value })}
        />
        <select
          aria-label={t('list.filterLabel')}
          value={query.status}
          onChange={(event) => setQuery({ ...query, status: event.target.value as StatusFilter })}
        >
          {STATUS_FILTERS.map((value) => (
            <option key={value} value={value}>
              {value === 'all' ? t('list.filterAll') : t(`status.${value satisfies WatchStatus}`)}
            </option>
          ))}
        </select>
        <select
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

      {visible.length === 0 ? (
        <p>{hasEntries ? t('list.emptyFiltered') : t('list.empty')}</p>
      ) : (
        <ul className="items">
          {visible.map((entry) => (
            <li key={entry.id}>
              <a
                className="item"
                href={routeHref({
                  name: 'title',
                  mediaType: entry.mediaType,
                  tmdbId: entry.tmdbId,
                })}
              >
                <PosterImage posterPath={entry.posterPath} title={entry.title} />
                <span className="item-main">
                  <strong>{entry.title}</strong>
                  {entry.year !== undefined && <span className="muted">{entry.year}</span>}
                  <span className="muted">
                    {t(`mediaType.${entry.mediaType}`)} · {t(`status.${entry.status}`)}
                    {entry.rating !== undefined && (
                      <> · {t('list.ratingBadge', { rating: entry.rating })}</>
                    )}
                  </span>
                  {entry.source && <span className="muted">{entry.source}</span>}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
