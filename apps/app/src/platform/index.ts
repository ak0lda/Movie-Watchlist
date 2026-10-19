import {
  ConfiguredSyncBackend,
  SyncEngine,
  type DesktopApi,
  type LocalStore,
} from '@movie-watchlist/core';
import { IpcSyncProvider } from '../sync/IpcSyncProvider';
import { SyncService, type VisibilitySource } from '../sync/SyncService';
import { createSyncSettingsApi, type SyncSettingsApi } from '../sync/syncSettingsApi';
import { BackendSyncProvider, settingsApiFromBackend } from './BackendSyncProvider';
import { createCapacitorTransport } from './native/CapacitorTransport';
import {
  LocalStorageConfigPort,
  SecureStorageSecretPort,
  type SecureStorageLike,
} from './native/storage';
import type { WebDavHttpPlugin } from './native/webDavHttp';

/** The part of @capacitor/app used to learn that the app went to the background. */
export interface AppStateSource {
  addListener(
    event: 'appStateChange',
    listener: (state: { isActive: boolean }) => void,
  ): Promise<{ remove(): Promise<void> }>;
}

export interface AndroidPlatform {
  webDavHttp: Pick<WebDavHttpPlugin, 'request'>;
  secureStorage: SecureStorageLike;
  app: AppStateSource;
  /** Non-secret settings storage (the WebView's localStorage). */
  storage: Pick<Storage, 'getItem' | 'setItem'>;
}

export interface PlatformDeps {
  /** Present inside the Electron shell. */
  desktop: DesktopApi | undefined;
  /** Present inside the Android app. */
  android: AndroidPlatform | undefined;
  document: VisibilitySource;
}

export interface PlatformSync {
  service: SyncService;
  settings: SyncSettingsApi;
}

/**
 * Wires sync for the current platform and starts its triggers (app start, going to the
 * background, the button). Returns undefined in a plain browser, which works without sync.
 */
export function startPlatformSync(deps: PlatformDeps, store: LocalStore): PlatformSync | undefined {
  if (deps.desktop) {
    const engine = new SyncEngine({ provider: new IpcSyncProvider(deps.desktop.sync), store });
    const service = new SyncService(engine);
    service.start(deps.document, deps.desktop.onWindowHidden);
    return { service, settings: createSyncSettingsApi(deps.desktop.sync) };
  }

  if (deps.android) {
    const { app } = deps.android;
    const backend = new ConfiguredSyncBackend({
      configStore: new LocalStorageConfigPort(deps.android.storage),
      secretStore: new SecureStorageSecretPort(deps.android.secureStorage),
      transport: createCapacitorTransport(deps.android.webDavHttp),
      allowInsecureLoopback: false,
    });
    const engine = new SyncEngine({ provider: new BackendSyncProvider(backend), store });
    const service = new SyncService(engine);
    service.start(deps.document, (listener) => {
      const handle = app.addListener('appStateChange', (state) => {
        if (!state.isActive) listener();
      });
      return () => {
        void handle.then((registered) => registered.remove());
      };
    });
    return { service, settings: settingsApiFromBackend(backend) };
  }

  return undefined;
}
