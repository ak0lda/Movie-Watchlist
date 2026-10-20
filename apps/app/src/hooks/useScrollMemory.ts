import { useLayoutEffect } from 'react';

/** Where the list was scrolled to when the user last left it (this app session only). */
let listScrollY = 0;

/** Every screen but the list opens at the top; without this a title opened from far down the list
 * would start scrolled to the list's position. */
export function useScrollToTop(routeKey: string, skip: boolean): void {
  useLayoutEffect(() => {
    if (!skip) window.scrollTo(0, 0);
  }, [routeKey, skip]);
}

/** Returns the list to where the user left it once its content is rendered, and keeps tracking it.
 * A layout-effect cleanup stops tracking before the browser clamps the scroll for the next screen. */
export function useListScrollMemory(ready: boolean): void {
  useLayoutEffect(() => {
    if (!ready) return;
    window.scrollTo(0, listScrollY);
    const remember = () => {
      listScrollY = window.scrollY;
    };
    window.addEventListener('scroll', remember, { passive: true });
    return () => window.removeEventListener('scroll', remember);
  }, [ready]);
}
