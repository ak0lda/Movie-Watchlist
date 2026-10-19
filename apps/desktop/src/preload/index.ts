import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '@movie-watchlist/core';
import { CHANNELS, EVENTS } from '../shared/channels';

// The whole surface exposed to the page. Each method forwards to one fixed channel; the main
// process validates every argument, so nothing here trusts its input either.
const sync: DesktopApi['sync'] = {
  getConfig: () => ipcRenderer.invoke(CHANNELS.getConfig),
  saveConfig: (input) => ipcRenderer.invoke(CHANNELS.saveConfig, input),
  clearPassword: () => ipcRenderer.invoke(CHANNELS.clearPassword),
  download: () => ipcRenderer.invoke(CHANNELS.download),
  upload: (data, etag) => ipcRenderer.invoke(CHANNELS.upload, data, etag),
};

const api: DesktopApi = {
  sync: Object.freeze(sync),
  // The Electron event object is never handed to the page, only a plain notification.
  onWindowHidden: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(EVENTS.windowHidden, handler);
    return () => {
      ipcRenderer.removeListener(EVENTS.windowHidden, handler);
    };
  },
};

contextBridge.exposeInMainWorld('desktop', Object.freeze(api));
