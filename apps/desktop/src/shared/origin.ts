/**
 * `protocol//host[:port]` of a URL, or null if it cannot be parsed.
 *
 * `URL.origin` cannot be used here: in Node it is the string "null" for non-special schemes such as
 * app://, which would make every comparison against the app's own pages fail (or, worse, match
 * any two such URLs).
 */
export function originKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.host) return null;
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}
