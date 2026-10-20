import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  protocol,
  safeStorage,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { APP_HOST, APP_ORIGIN, APP_SCHEME, EVENTS } from '../shared/channels';
import { originKey } from '../shared/origin';
import { ConfigStore } from './configStore';
import { createHandlers, type IpcSender } from './ipc';
import { createFetchTransport, type FetchLike } from './netTransport';
import { createSafeStorageCrypto, SecretStore } from './secretStore';
import { buildCsp, isAllowedExternalUrl, isAllowedNavigation } from './security';
import { MainSyncBackend } from './syncBackend';

// Test and development knobs. They are ignored in a packaged build.
const devMode = !app.isPackaged;
const e2e = devMode && process.env['MW_E2E'] === '1';
// E2E windows stay hidden unless a test needs real window events (minimise).
const showWindow = !e2e || process.env['MW_E2E_SHOW'] === '1';
const rendererDevUrl = devMode ? process.env['MW_RENDERER_URL'] : undefined;
const allowInsecureLoopback = devMode && process.env['MW_ALLOW_LOOPBACK_HTTP'] === '1';
const userDataOverride = devMode ? process.env['MW_USER_DATA_DIR'] : undefined;
if (userDataOverride) app.setPath('userData', userDataOverride);

const trustedOrigin = rendererDevUrl ? (originKey(rendererDevUrl) ?? APP_ORIGIN) : APP_ORIGIN;
// Packaged: scripts/dist.mjs copies the renderer into the app archive. Unpackaged: the app workspace's build.
const rendererDir = app.isPackaged
  ? path.join(app.getAppPath(), 'renderer')
  : path.resolve(__dirname, '../../app/dist');

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function registerAppProtocol(): void {
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.hostname !== APP_HOST) return new Response('Not found', { status: 404 });
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const resolved = path.resolve(rendererDir, `.${pathname}`);
    const inside = resolved.startsWith(rendererDir + path.sep);
    if (!inside) return new Response('Forbidden', { status: 403 });
    if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(resolved).toString());
  });
}

function registerIpc(): void {
  const backend = new MainSyncBackend({
    configStore: new ConfigStore(path.join(app.getPath('userData'), 'sync-config.json')),
    secretStore: new SecretStore(
      path.join(app.getPath('userData'), 'sync-secret.bin'),
      createSafeStorageCrypto(safeStorage),
    ),
    transport: createFetchTransport(net.fetch as unknown as FetchLike),
    allowInsecureLoopback,
  });
  const handlers = createHandlers(backend, { trustedOrigin, allowInsecureLoopback });

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      const sender: IpcSender = {
        url: event.senderFrame?.url,
        isMainFrame: event.senderFrame !== null && event.senderFrame === event.sender.mainFrame,
      };
      return handler(sender, ...args);
    });
  }
}

function hardenSession(): void {
  const { defaultSession } = session;
  defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  defaultSession.setPermissionCheckHandler(() => false);
  // The dev server needs inline scripts for hot reload, so the CSP applies to app:// pages only.
  defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith(`${APP_SCHEME}://`)) return callback({});
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [buildCsp()] },
    });
  });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1000,
    height: 760,
    show: showWindow,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  const { webContents } = window;
  // Tell the page when the window is minimised or hidden so it can sync (see DesktopApi).
  const notifyHidden = () => {
    if (!webContents.isDestroyed()) webContents.send(EVENTS.windowHidden);
  };
  window.on('minimize', notifyHidden);
  window.on('hide', notifyHidden);
  webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, trustedOrigin)) event.preventDefault();
  });
  webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  void window.loadURL(rendererDevUrl ?? `${APP_ORIGIN}/index.html`);
  return window;
}

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (attachEvent) => attachEvent.preventDefault());
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  void app.whenReady().then(() => {
    hardenSession();
    registerAppProtocol();
    registerIpc();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
