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

void requestPersistence();

createRoot(container).render(
  <StrictMode>
    <ServicesProvider value={services}>
      <App />
    </ServicesProvider>
  </StrictMode>,
);
