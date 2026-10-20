import type { CapacitorConfig } from '@capacitor/cli';

// CapacitorHttp stays off: WebDAV needs verbs such as MKCOL that Android's HttpURLConnection
// (which CapacitorHttp uses) rejects, so the app ships its own WebDavHttp plugin instead.
const config: CapacitorConfig = {
  appId: 'app.moviewatchlist',
  appName: 'Movie Watchlist',
  webDir: 'dist',
  // Never log plugin call data: it contains the sync password and API keys.
  loggingBehavior: 'none',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false },
};

export default config;
