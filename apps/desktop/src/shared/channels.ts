/** IPC channel names, shared by the preload script and the main-process handlers. */
export const CHANNELS = {
  getConfig: 'mw:sync:getConfig',
  saveConfig: 'mw:sync:saveConfig',
  clearPassword: 'mw:sync:clearPassword',
  download: 'mw:sync:download',
  upload: 'mw:sync:upload',
} as const;

/** Events pushed from the main process to the renderer. */
export const EVENTS = { windowHidden: 'mw:window:hidden' } as const;

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

export const APP_SCHEME = 'app';
export const APP_HOST = 'watchlist';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
