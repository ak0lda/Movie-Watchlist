import { useTranslation } from 'react-i18next';
import { routeHref, useHashRoute, type Route } from './hooks/useHashRoute';
import { useScrollToTop } from './hooks/useScrollMemory';
import { DetailsScreen } from './ui/DetailsScreen';
import { ListScreen } from './ui/ListScreen';
import { SearchScreen } from './ui/SearchScreen';
import { SettingsScreen } from './ui/SettingsScreen';
import { Icon, Icons, type IconName } from './ui/icons';
import { SyncButton } from './ui/SyncButton';

const NAV: { route: Route; labelKey: string; icon: IconName }[] = [
  { route: { name: 'list' }, labelKey: 'nav.list', icon: 'list' },
  { route: { name: 'search' }, labelKey: 'nav.search', icon: 'search' },
  { route: { name: 'settings' }, labelKey: 'nav.settings', icon: 'settings' },
];

/** A title page belongs to the list tab, so the tab stays highlighted while it is open. */
function isCurrent(route: Route, tab: Route): boolean {
  return route.name === tab.name || (route.name === 'title' && tab.name === 'list');
}

export function App() {
  const { t } = useTranslation();
  const route = useHashRoute();
  // The list restores its own scroll position (useListScrollMemory).
  useScrollToTop(routeHref(route), route.name === 'list');

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href={routeHref({ name: 'list' })}>
          <span className="brand-mark">
            <Icons.film />
          </span>
          <span>{t('app.title')}</span>
        </a>
        <nav className="tabs">
          {NAV.map((item) => (
            <a
              key={item.route.name}
              className="tab"
              href={routeHref(item.route)}
              aria-current={isCurrent(route, item.route) ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              <span>{t(item.labelKey)}</span>
            </a>
          ))}
        </nav>
        <SyncButton />
      </header>
      <main key={route.name}>
        {route.name === 'list' && <ListScreen />}
        {route.name === 'search' && (
          <SearchScreen
            // A new share replaces the text even if the search screen is already open.
            key={`${route.query ?? ''}|${route.notFound ? 1 : 0}|${route.received ?? ''}|${route.kinopoiskId ?? ''}`}
            initialQuery={route.query ?? ''}
            shareNotFound={route.notFound === true}
            shareReceived={route.received}
            kinopoiskId={route.kinopoiskId}
          />
        )}
        {route.name === 'settings' && <SettingsScreen />}
        {route.name === 'title' && (
          <DetailsScreen mediaType={route.mediaType} tmdbId={route.tmdbId} />
        )}
      </main>
      <footer>
        <small>{t('tmdb.attribution')}</small>
      </footer>
    </div>
  );
}
