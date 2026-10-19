const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** UTF-8 bytes of a string without TextEncoder (core targets no particular platform). */
export function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (const char of text) {
    // `for...of` iterates code points, so surrogate pairs arrive joined.
    const code = char.codePointAt(0) ?? 0xfffd;
    const point = code >= 0xd800 && code <= 0xdfff ? 0xfffd : code;
    if (point < 0x80) bytes.push(point);
    else if (point < 0x800) bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    else if (point < 0x10000) {
      bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    } else {
      bytes.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return bytes;
}

export function base64Encode(bytes: readonly number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const triple = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    out += ALPHABET[(triple >> 18) & 63];
    out += ALPHABET[(triple >> 12) & 63];
    out += b1 === undefined ? '=' : ALPHABET[(triple >> 6) & 63];
    out += b2 === undefined ? '=' : ALPHABET[triple & 63];
  }
  return out;
}

/** HTTP Basic credentials, UTF-8 encoded (RFC 7617). */
export function basicAuthHeader(login: string, password: string): string {
  return `Basic ${base64Encode(utf8Bytes(`${login}:${password}`))}`;
}
