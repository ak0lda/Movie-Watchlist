import { originKey } from '../shared/origin';

/**
 * Content-Security-Policy for pages served from app://. The renderer talks to TMDB over https
 * (the base URL is configurable, hence `https:`), shows TMDB posters, and nothing else.
 */
export function buildCsp(): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self' https:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/** In-window navigation is allowed only inside the app's own origin. */
export function isAllowedNavigation(url: string, trustedOrigin: string): boolean {
  return originKey(url) === trustedOrigin;
}

/** Links that leave the app open in the system browser, https only. */
export function isAllowedExternalUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}
