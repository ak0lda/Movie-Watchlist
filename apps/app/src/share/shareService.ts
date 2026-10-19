import { routeHref } from '../hooks/useHashRoute';
import { parseSharedText } from './parseSharedText';

/** The native ShareTarget plugin: emits `shareReceived` for text shared from other apps. */
export interface ShareTargetPlugin {
  addListener(
    event: 'shareReceived',
    listener: (event: { text?: unknown }) => void,
  ): Promise<{ remove(): Promise<void> }>;
}

/** The route a share leads to: search with the title filled in, or a hint if none was found. */
export function shareHref(text: unknown): string {
  const query = parseSharedText(text);
  return routeHref(query ? { name: 'search', query } : { name: 'search', notFound: true });
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
  const handle = plugin.addListener('shareReceived', (event) => navigate(shareHref(event.text)));
  return () => {
    void handle.then((registered) => registered.remove());
  };
}
