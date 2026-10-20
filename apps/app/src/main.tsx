import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { TmdbCatalogProvider } from './catalog/tmdb';
import { WatchlistDb } from './data/db';
import { MetaCache } from './data/metaCache';
import { requestPersistence } from './data/persist';
import { EntryRepository } from './data/repository';
import './i18n';
import { startPlatformSync } from './platform';
import { createCapacitorTransport } from './platform/native/CapacitorTransport';
import { WebDavHttp } from './platform/native/webDavHttp';
import { ServicesProvider, type Services } from './services';
import { createKinopoiskResolver } from './share/kinopoisk';
import { startShareHandling } from './share/shareService';
import { ShareTarget } from './share/shareTarget';
import { SettingsStore, resolveTmdbConfig } from './settings/settings';
import { getDesktopApi } from './sync/desktopApi';
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

const sync = startPlatformSync(
  {
    desktop: getDesktopApi(),
    // Only the real Android app gets the Keystore-backed secret storage; the plugin's web
    // fallback keeps values unencrypted, so it must never be used for the password.
    android:
      Capacitor.getPlatform() === 'android'
        ? {
            webDavHttp: WebDavHttp,
            secureStorage: SecureStorage,
            app: CapacitorApp,
            storage: localStorage,
          }
        : undefined,
    document,
  },
  services.repo,
);
if (sync) services.sync = sync;

// "Share" from other Android apps opens the search screen with the shared title.
if (Capacitor.getPlatform() === 'android') {
  // The native HTTP plugin sends the request, so the page's CORS rules do not apply to it.
  services.kinopoisk = createKinopoiskResolver({
    transport: createCapacitorTransport(WebDavHttp),
    getKey: () => settings.get().kinopoiskKey,
  });
  startShareHandling(ShareTarget, (href) => {
    window.location.hash = href;
  });
}

void requestPersistence();

createRoot(container).render(
  <StrictMode>
    <ServicesProvider value={services}>
      <App />
    </ServicesProvider>
  </StrictMode>,
);
