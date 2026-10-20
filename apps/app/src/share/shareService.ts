import { routeHref } from '../hooks/useHashRoute';
import { extractKinopoiskId } from './kinopoisk';
import { parseSharedText } from './parseSharedText';

/** Text fields of a share as the native plugin reports them; any may be missing. */
export interface ShareEvent {
  /** EXTRA_TEXT (or the clip text). */
  text?: unknown;
  /** EXTRA_SUBJECT: Chrome sends the page title here and only the URL as text. */
  subject?: unknown;
  /** EXTRA_TITLE. */
  title?: unknown;
}

/** The native ShareTarget plugin: emits `shareReceived` for text shared from other apps. */
export interface ShareTargetPlugin {
  addListener(
    event: 'shareReceived',
    listener: (event: ShareEvent) => void,
  ): Promise<{ remove(): Promise<void> }>;
}

/** How much of the received text is echoed back to the user when no title was found. */
export const MAX_RECEIVED_LENGTH = 300;

export interface ParsedShare {
  /** The title to search for; empty when none was found. */
  query: string;
  /** The raw received text (all fields), for showing the user what arrived. */
  received: string;
  /** A Kinopoisk film/series number found in the share when no title was (needs a lookup). */
  kinopoiskId?: number;
}

/** Looks for a title in the text first, then the subject, then the title field. */
export function parseShare(event: unknown): ParsedShare {
  const source = typeof event === 'object' && event !== null ? (event as ShareEvent) : {};
  const fields = [source.text, source.subject, source.title]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value !== '');

  let query = '';
  for (const field of fields) {
    query = parseSharedText(field);
    if (query) break;
  }
  const received = [...new Set(fields)].join(' | ').slice(0, MAX_RECEIVED_LENGTH);
  if (query) return { query, received };
  const kinopoiskId = extractKinopoiskId(fields);
  return kinopoiskId === null ? { query, received } : { query, received, kinopoiskId };
}

/**
 * The route a share leads to: the search with the title filled in, or an empty search that tells
 * the user what was received.
 */
export function shareHref(event: unknown): string {
  const { query, received, kinopoiskId } = parseShare(event);
  if (query) return routeHref({ name: 'search', query });
  if (kinopoiskId !== undefined) {
    return routeHref({ name: 'search', kinopoiskId, ...(received ? { received } : {}) });
  }
  return routeHref({ name: 'search', notFound: true, ...(received ? { received } : {}) });
}

/**
 * Opens the search screen whenever another app shares text with us. The native plugin retains an
 * event that arrived before JS subscribed, so a share that launched the app is delivered too.
 * Returns a disposer.
 */
export function startShareHandling(
  plugin: ShareTargetPlugin,
  navigate: (href: string) => void,
): () => void {
  const handle = plugin.addListener('shareReceived', (event) => navigate(shareHref(event)));
  return () => {
    void handle.then((registered) => registered.remove());
  };
}
