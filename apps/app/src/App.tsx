import { useTranslation } from 'react-i18next';
import { routeHref, useHashRoute, type Route } from './hooks/useHashRoute';
import { DetailsScreen } from './ui/DetailsScreen';
import { ListScreen } from './ui/ListScreen';
import { SearchScreen } from './ui/SearchScreen';
import { SettingsScreen } from './ui/SettingsScreen';
import { SyncButton } from './ui/SyncButton';

const NAV: { route: Route; labelKey: string }[] = [
  { route: { name: 'list' }, labelKey: 'nav.list' },
  { route: { name: 'search' }, labelKey: 'nav.search' },
  { route: { name: 'settings' }, labelKey: 'nav.settings' },
];

export function App() {
  const { t } = useTranslation();
  const route = useHashRoute();

  return (
    <div className="app">
      <header>
        <span className="brand">{t('app.title')}</span>
        <nav>
          {NAV.map((item) => (
            <a
              key={item.route.name}
              href={routeHref(item.route)}
              aria-current={route.name === item.route.name ? 'page' : undefined}
            >
              {t(item.labelKey)}
            </a>
          ))}
        </nav>
        <SyncButton />
      </header>
      <main>
        {route.name === 'list' && <ListScreen />}
        {route.name === 'search' && (
          <SearchScreen
            // A new share replaces the text even if the search screen is already open.
            key={`${route.query ?? ''}|${route.notFound ? 1 : 0}`}
            initialQuery={route.query ?? ''}
            shareNotFound={route.notFound === true}
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
