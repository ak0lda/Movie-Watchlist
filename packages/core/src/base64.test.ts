import { describe, expect, it } from 'vitest';
import { base64Encode, basicAuthHeader, utf8Bytes } from './base64';

// Expected values come from Node's Buffer (the oracle) and are pinned here.
describe('basicAuthHeader', () => {
  it.each([
    ['user', 'pass', 'dXNlcjpwYXNz'],
    ['логин', 'пароль', '0LvQvtCz0LjQvTrQv9Cw0YDQvtC70Yw='],
    ['a', 'b🎬', 'YTpi8J+OrA=='],
    ['é', 'ü', 'w6k6w7w='],
    ['x', '', 'eDo='],
  ])('encodes %j:%j', (login, password, expected) => {
    expect(basicAuthHeader(login, password)).toBe(`Basic ${expected}`);
  });
});

describe('base64Encode', () => {
  it('handles every padding length', () => {
    expect(base64Encode(utf8Bytes(''))).toBe('');
    expect(base64Encode(utf8Bytes('ab'))).toBe('YWI=');
    expect(base64Encode(utf8Bytes('abc'))).toBe('YWJj');
    expect(base64Encode(utf8Bytes('abcd'))).toBe('YWJjZA==');
  });
});

describe('utf8Bytes', () => {
  it('encodes 1-4 byte sequences', () => {
    expect(utf8Bytes('a')).toEqual([0x61]);
    expect(utf8Bytes('é')).toEqual([0xc3, 0xa9]);
    expect(utf8Bytes('€')).toEqual([0xe2, 0x82, 0xac]);
    expect(utf8Bytes('🎬')).toEqual([0xf0, 0x9f, 0x8e, 0xac]);
  });

  it('replaces a lone surrogate with U+FFFD', () => {
    expect(utf8Bytes('\ud800')).toEqual([0xef, 0xbf, 0xbd]);
  });
});
