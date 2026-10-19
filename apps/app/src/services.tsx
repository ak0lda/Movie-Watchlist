import type { CatalogProvider } from '@movie-watchlist/core';
import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import type { MetaCache } from './data/metaCache';
import type { EntryRepository } from './data/repository';
import {
  resolveTmdbConfig,
  type Settings,
  type SettingsStore,
  type TmdbConfig,
} from './settings/settings';

export interface Services {
  repo: EntryRepository;
  metaCache: MetaCache;
  catalog: CatalogProvider;
  settings: SettingsStore;
  /** `VITE_TMDB_API_KEY` from `.env`, used when the settings field is empty. */
  tmdbEnvKey: string;
}

const ServicesContext = createContext<Services | null>(null);

export const ServicesProvider = ServicesContext.Provider;

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('ServicesProvider is missing');
  return services;
}

export function useSettings(): Settings {
  const { settings } = useServices();
  return useSyncExternalStore(settings.subscribe, settings.get);
}

export function useTmdbConfig(): TmdbConfig {
  const settings = useSettings();
  const { tmdbEnvKey } = useServices();
  return useMemo(() => resolveTmdbConfig(settings, tmdbEnvKey), [settings, tmdbEnvKey]);
}
