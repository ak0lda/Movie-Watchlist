import { describe, expect, it } from 'vitest';
import { APP_ORIGIN } from '../src/shared/channels';
import { buildCsp, isAllowedExternalUrl, isAllowedNavigation } from '../src/main/security';

describe('buildCsp', () => {
  const directives = new Map(
    buildCsp()
      .split('; ')
      .map((directive) => {
        const [name, ...values] = directive.split(' ');
        return [name, values] as const;
      }),
  );

  it('allows scripts only from the app itself (no inline, no eval)', () => {
    expect(directives.get('script-src')).toEqual(["'self'"]);
  });

  it('blocks plugins, base rewriting, form posts and framing', () => {
    expect(directives.get('object-src')).toEqual(["'none'"]);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    expect(directives.get('form-action')).toEqual(["'none'"]);
    expect(directives.get('frame-ancestors')).toEqual(["'none'"]);
  });

  it('limits network access to the app and https (no plain http, no wildcards)', () => {
    expect(directives.get('connect-src')).toEqual(["'self'", 'https:']);
    expect(directives.get('img-src')).toEqual(["'self'", 'data:', 'https:']);
    expect(buildCsp()).not.toContain('http:');
    expect(buildCsp()).not.toContain('*');
  });
});

describe('navigation policy', () => {
  it('keeps navigation inside the app origin', () => {
    expect(isAllowedNavigation(`${APP_ORIGIN}/index.html#/settings`, APP_ORIGIN)).toBe(true);
    expect(isAllowedNavigation('https://example.com/', APP_ORIGIN)).toBe(false);
    expect(isAllowedNavigation('app://watchlist.evil.com/', APP_ORIGIN)).toBe(false);
    expect(isAllowedNavigation('file:///etc/passwd', APP_ORIGIN)).toBe(false);
    expect(isAllowedNavigation('javascript:alert(1)', APP_ORIGIN)).toBe(false);
    expect(isAllowedNavigation('garbage', APP_ORIGIN)).toBe(false);
  });

  it('opens only https links externally', () => {
    expect(isAllowedExternalUrl('https://www.themoviedb.org/')).toBe(true);
    for (const url of [
      'http://example.com',
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'ms-msdt:/id',
      'smb://host/share',
      'nonsense',
    ]) {
      expect(isAllowedExternalUrl(url)).toBe(false);
    }
  });
});
