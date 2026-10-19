import type { DesktopApi } from '@movie-watchlist/core';

declare global {
  interface Window {
    /** Present only inside the Electron shell (exposed by its preload script). */
    desktop?: DesktopApi;
  }
}

export function getDesktopApi(): DesktopApi | undefined {
  return typeof window === 'undefined' ? undefined : window.desktop;
}
