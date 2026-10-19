import type { DesktopApi } from '@movie-watchlist/core';

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

export {};
