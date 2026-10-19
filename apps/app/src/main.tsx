import { SyncEngine } from '@movie-watchlist/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { TmdbCatalogProvider } from './catalog/tmdb';
import { WatchlistDb } from './data/db';
import { MetaCache } from './data/metaCache';
import { requestPersistence } from './data/persist';
import { EntryRepository } from './data/repository';
import './i18n';
import { ServicesProvider, type Services } from './services';
import { SettingsStore, resolveTmdbConfig } from './settings/settings';
import { getDesktopApi } from './sync/desktopApi';
import { IpcSyncProvider } from './sync/IpcSyncProvider';
import { SyncService } from './sync/SyncService';
import { createSyncSettingsApi } from './sync/syncSettingsApi';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

const db = new WatchlistDb();
const settings = new SettingsStore(localStorage);
const tmdbEnvKey = import.meta.env.VITE_TMDB_API_KEY ?? '';

const services: Services = {
  repo: new EntryRepository(db),
  metaCache: new MetaCache(db),
  catalog: new TmdbCatalogProvider({
    getConfig: () => resolveTmdbConfig(settings.get(), tmdbEnvKey),
  }),
  settings,
  tmdbEnvKey,
};

const desktop = getDesktopApi();
if (desktop) {
  const engine = new SyncEngine({
    provider: new IpcSyncProvider(desktop.sync),
    store: services.repo,
  });
  const service = new SyncService(engine);
  services.sync = { service, settings: createSyncSettingsApi(desktop.sync) };
  service.start(document, desktop.onWindowHidden);
}

void requestPersistence();

createRoot(container).render(
  <StrictMode>
    <ServicesProvider value={services}>
      <App />
    </ServicesProvider>
  </StrictMode>,
);
