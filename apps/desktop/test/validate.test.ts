import { ConfigError } from '@movie-watchlist/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAX_UPLOAD_BYTES,
  isTrustedSender,
  validateNoArgs,
  validateSaveConfig,
  validateUploadArgs,
} from '../src/main/validate';

const OPTIONS = { allowInsecureLoopback: false };
const VALID = {
  serverUrl: 'https://webdav.yandex.ru',
  filePath: '/Apps/MovieWatchlist/movies.json',
  login: 'user@yandex.ru',
  password: 'app-password',
};

describe('validateSaveConfig', () => {
  it('accepts a valid config and trims the URL', () => {
    expect(
      validateSaveConfig({ ...VALID, serverUrl: '  https://webdav.yandex.ru  ' }, OPTIONS),
    ).toEqual(VALID);
  });

  it('treats a missing or empty password as "keep the stored one"', () => {
    const { password, ...withoutPassword } = VALID;
    void password;
    expect(validateSaveConfig(withoutPassword, OPTIONS)).toEqual(withoutPassword);
    expect(validateSaveConfig({ ...VALID, password: '' }, OPTIONS)).toEqual(withoutPassword);
  });

  it('drops unknown properties', () => {
    const result = validateSaveConfig(
      { ...VALID, extra: 'x', __proto__: { polluted: true } },
      OPTIONS,
    );
    expect(Object.keys(result).sort()).toEqual(['filePath', 'login', 'password', 'serverUrl']);
  });

  it.each([
    ['not an object', 'text'],
    ['null', null],
    ['array', []],
    ['http url', { ...VALID, serverUrl: 'http://webdav.yandex.ru' }],
    ['url with credentials', { ...VALID, serverUrl: 'https://u:p@webdav.yandex.ru' }],
    ['non-string url', { ...VALID, serverUrl: 42 }],
    ['huge url', { ...VALID, serverUrl: `https://${'a'.repeat(3000)}.example` }],
    ['relative path', { ...VALID, filePath: 'movies.json' }],
    ['traversal path', { ...VALID, filePath: '/a/../etc/passwd' }],
    ['non-string path', { ...VALID, filePath: ['/a'] }],
    ['empty login', { ...VALID, login: '' }],
    ['login with colon', { ...VALID, login: 'a:b' }],
    ['login with newline', { ...VALID, login: 'a\nb' }],
    ['huge login', { ...VALID, login: 'x'.repeat(257) }],
    ['non-string login', { ...VALID, login: { toString: (): string => 'x' } }],
    ['password with newline', { ...VALID, password: 'a\r\nb' }],
    ['huge password', { ...VALID, password: 'x'.repeat(1025) }],
    ['non-string password', { ...VALID, password: 123 }],
  ])('rejects %s', (_name, input) => {
    expect(() => validateSaveConfig(input, OPTIONS)).toThrow(ConfigError);
  });

  it('allows http on loopback only when explicitly enabled', () => {
    const local = { ...VALID, serverUrl: 'http://127.0.0.1:8080' };
    expect(() => validateSaveConfig(local, OPTIONS)).toThrow(ConfigError);
    expect(validateSaveConfig(local, { allowInsecureLoopback: true }).serverUrl).toBe(
      'http://127.0.0.1:8080',
    );
    expect(() =>
      validateSaveConfig(
        { ...VALID, serverUrl: 'http://evil.example' },
        { allowInsecureLoopback: true },
      ),
    ).toThrow(ConfigError);
  });

  it('fuzz: anything is either a clean config or a ConfigError, nothing else', () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        try {
          const result = validateSaveConfig(input, OPTIONS);
          expect(result.serverUrl.startsWith('https://')).toBe(true);
          expect(result.filePath.startsWith('/')).toBe(true);
          expect(result.filePath.split('/')).not.toContain('..');
          expect(result.login).not.toContain(':');
        } catch (error) {
          expect(error).toBeInstanceOf(ConfigError);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('fuzz: structured random fields never produce an unsafe accepted config', () => {
    const text = fc.oneof(
      fc.string(),
      fc.constantFrom('https://a.example', '/a/b.json', 'user', '..', '/../x', 'http://a.example'),
    );
    fc.assert(
      fc.property(
        fc.record({
          serverUrl: text,
          filePath: text,
          login: text,
          password: fc.option(text, { nil: undefined }),
        }),
        (input) => {
          try {
            const result = validateSaveConfig(input, OPTIONS);
            expect(new URL(result.serverUrl).protocol).toBe('https:');
            expect(
              result.filePath
                .split('/')
                .slice(1)
                .every((s) => s !== '' && s !== '.' && s !== '..'),
            ).toBe(true);
          } catch (error) {
            expect(error).toBeInstanceOf(ConfigError);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe('validateUploadArgs', () => {
  it('accepts a string payload with an etag or null', () => {
    expect(validateUploadArgs('{}', '"abc"')).toEqual({ data: '{}', etag: '"abc"' });
    expect(validateUploadArgs('{}', null)).toEqual({ data: '{}', etag: null });
  });

  it.each([
    ['non-string data', 5, null],
    ['object data', {}, null],
    ['undefined etag', '{}', undefined],
    ['numeric etag', '{}', 1],
    ['empty etag', '{}', ''],
    ['etag with CRLF (header injection)', '{}', '"a"\r\nX-Evil: 1'],
    ['etag with NUL', '{}', '"a\u0000"'],
    ['huge etag', '{}', 'x'.repeat(513)],
  ])('rejects %s', (_name, data, etag) => {
    expect(() => validateUploadArgs(data, etag)).toThrow(ConfigError);
  });

  it('enforces the byte limit, counting multi-byte characters', () => {
    expect(validateUploadArgs('a'.repeat(MAX_UPLOAD_BYTES), null).data).toHaveLength(
      MAX_UPLOAD_BYTES,
    );
    expect(() => validateUploadArgs('a'.repeat(MAX_UPLOAD_BYTES + 1), null)).toThrow(ConfigError);
    // 6M Cyrillic letters are 12 MB in UTF-8 although only 6M characters long.
    expect(() => validateUploadArgs('я'.repeat(6_000_000), null)).toThrow(ConfigError);
  });

  it('fuzz: only ConfigError escapes', () => {
    fc.assert(
      fc.property(fc.anything(), fc.anything(), (data, etag) => {
        try {
          const result = validateUploadArgs(data, etag);
          expect(typeof result.data).toBe('string');
          if (result.etag !== null) {
            const forbidden = [13, 10, 0].map((code) => String.fromCharCode(code));
            expect(forbidden.some((char) => result.etag?.includes(char))).toBe(false);
          }
        } catch (error) {
          expect(error).toBeInstanceOf(ConfigError);
        }
      }),
      { numRuns: 500 },
    );
  });
});

describe('validateNoArgs', () => {
  it('allows none and rejects any', () => {
    expect(() => validateNoArgs([])).not.toThrow();
    expect(() => validateNoArgs([undefined])).toThrow(ConfigError);
  });
});

describe('isTrustedSender', () => {
  const ORIGIN = 'app://watchlist';
  it.each([
    ['app://watchlist/index.html', true, true],
    ['app://watchlist/', true, true],
    ['app://watchlist/#/settings', true, true],
    ['app://watchlist/index.html', false, false],
    ['app://watchlist.evil.com/', true, false],
    ['app://other/', true, false],
    ['http://watchlist/', true, false],
    ['https://example.com/', true, false],
    ['file:///C:/x.html', true, false],
    ['about:blank', true, false],
    ['not a url', true, false],
    ['', true, false],
  ])('%s (mainFrame=%s) -> %s', (url, isMainFrame, expected) => {
    expect(isTrustedSender({ url, isMainFrame }, ORIGIN)).toBe(expected);
  });

  it('rejects a missing url', () => {
    expect(isTrustedSender({ url: undefined, isMainFrame: true }, ORIGIN)).toBe(false);
  });
});
