import { expect, test } from '@playwright/test';
import { launch, makeUserDataDir, type Instance } from './harness';

let instance: Instance;
let cleanup: () => Promise<void>;

test.beforeAll(async () => {
  const data = await makeUserDataDir();
  cleanup = data.cleanup;
  instance = await launch(data.dir);
});
test.afterAll(async () => {
  await instance.close();
  await cleanup();
});

test('serves the UI from the custom app:// origin and renders the shell', async () => {
  const { page } = instance;
  expect(page.url()).toMatch(/^app:\/\/watchlist\//);
  await expect(page.getByRole('navigation').getByRole('link', { name: 'My list' })).toBeVisible();
  await expect(
    page.getByText('This product uses the TMDB API but is not endorsed or certified by TMDB.'),
  ).toBeVisible();
  // Browser mode has no sync; the Electron shell exposes it.
  await expect(page.getByRole('button', { name: 'Sync', exact: true })).toBeVisible();
});

test('the page has no Node.js access (context isolation + sandbox)', async () => {
  const globals = await instance.page.evaluate(() => ({
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
    module: typeof (window as unknown as { module?: unknown }).module,
    buffer: typeof (window as unknown as { Buffer?: unknown }).Buffer,
  }));
  expect(globals).toEqual({
    require: 'undefined',
    process: 'undefined',
    module: 'undefined',
    buffer: 'undefined',
  });
});

test('exposes exactly the narrow desktop API', async () => {
  const shape = await instance.page.evaluate(() => {
    const api = window.desktop as unknown as Record<string, Record<string, unknown>>;
    return {
      top: Object.keys(api).sort(),
      sync: Object.keys(api['sync'] ?? {}).sort(),
      types: Object.values(api['sync'] ?? {}).map((value) => typeof value),
    };
  });
  expect(shape.top).toEqual(['onWindowHidden', 'sync']);
  expect(shape.sync).toEqual(['clearPassword', 'download', 'getConfig', 'saveConfig', 'upload']);
  expect(new Set(shape.types)).toEqual(new Set(['function']));
});

test('page scripts cannot tamper with the exposed API', async () => {
  const result = await instance.page.evaluate(async () => {
    const sync = window.desktop?.sync as unknown as Record<string, unknown>;
    try {
      sync['getConfig'] = () => Promise.resolve({ ok: true, value: 'hacked' });
    } catch {
      // Throwing is also fine.
    }
    return window.desktop?.sync.getConfig();
  });
  expect(result).toMatchObject({ ok: true });
  expect(JSON.stringify(result)).not.toContain('hacked');
});

test('IPC answers the trusted page and never exposes a password', async () => {
  const result = await instance.page.evaluate(() => window.desktop?.sync.getConfig());
  expect(result).toEqual({
    ok: true,
    value: {
      serverUrl: 'https://webdav.yandex.ru',
      filePath: '/Apps/MovieWatchlist/movies.json',
      login: '',
      hasPassword: false,
    },
  });
  expect(JSON.stringify(result)).not.toMatch(/"password"/);
});

test('IPC rejects malformed and unsafe input without crashing the app', async () => {
  const results = await instance.page.evaluate(async () => {
    const sync = window.desktop!.sync as unknown as Record<
      string,
      (...args: unknown[]) => Promise<{ ok: boolean; error?: { code: string } }>
    >;
    const good = {
      serverUrl: 'https://dav.example',
      filePath: '/a/b.json',
      login: 'user',
      password: 'pw',
    };
    // Extra arguments are not tested here: the preload forwards a fixed arity, so they never
    // reach the main process in the first place.
    const attempts: [string, unknown[]][] = [
      ['saveConfig', [{ ...good, serverUrl: 'http://evil.example' }]],
      ['saveConfig', [{ ...good, serverUrl: 'https://u:p@dav.example' }]],
      ['saveConfig', [{ ...good, filePath: '/a/../../etc/passwd' }]],
      ['saveConfig', [{ ...good, login: 'a:b' }]],
      ['saveConfig', [null]],
      ['saveConfig', [42]],
      ['saveConfig', [{}]],
      ['saveConfig', []],
      ['upload', [123, null]],
      ['upload', ['x', 'a\r\nInjected: header']],
      ['upload', ['x']],
    ];
    const out: { ok: boolean; code: string | undefined }[] = [];
    for (const [method, args] of attempts) {
      const result = await sync[method]!(...args);
      out.push({ ok: result.ok, code: result.error?.code });
    }
    return out;
  });
  for (const result of results) expect(result).toEqual({ ok: false, code: 'config' });
  // The app is still alive and answering.
  expect(
    await instance.page.evaluate(async () => (await window.desktop!.sync.getConfig()).ok),
  ).toBe(true);
});

test('a Content-Security-Policy is attached and blocks inline scripts', async () => {
  const { page } = instance;
  const csp = await page.evaluate(async () =>
    (await fetch(window.location.href)).headers.get('content-security-policy'),
  );
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("object-src 'none'");

  const injected = await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__pwned = 1';
    document.head.append(script);
    return (window as unknown as { __pwned?: number }).__pwned ?? null;
  });
  expect(injected).toBeNull();

  // Playwright's own evaluate() is exempt from eval restrictions, so the policy itself is checked.
  expect(csp).not.toContain('unsafe-eval');
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
});

test('the window cannot be navigated away from the app', async () => {
  const { page } = instance;
  await page.evaluate(() => {
    window.location.href = 'http://example.com/';
  });
  await page.waitForTimeout(700);
  expect(page.url()).toMatch(/^app:\/\/watchlist\//);
});

test('window.open does nothing for non-https targets', async () => {
  const { page, app } = instance;
  const opened = await page.evaluate(() =>
    [
      window.open('http://example.com/'),
      window.open('file:///C:/Windows/System32/drivers/etc/hosts'),
      window.open('javascript:alert(1)'),
    ].map((w) => w === null),
  );
  expect(opened).toEqual([true, true, true]);
  await page.waitForTimeout(300);
  expect(app.windows()).toHaveLength(1);
});

test('browser permissions are denied', async () => {
  const state = await instance.page.evaluate(
    async () => (await navigator.permissions.query({ name: 'geolocation' })).state,
  );
  expect(state).not.toBe('granted');
  const notification = await instance.page.evaluate(() => Notification.requestPermission());
  expect(notification).not.toBe('granted');
});

test('the app:// protocol cannot read files outside the renderer bundle', async () => {
  const bodies = await instance.page.evaluate(async () => {
    const paths = [
      '/../../desktop/package.json',
      '/%2e%2e/%2e%2e/desktop/package.json',
      '/..%2f..%2fdesktop%2fpackage.json',
      '/..\\..\\desktop\\package.json',
      '/assets/../../../desktop/package.json',
    ];
    const out: { status: number; leaked: boolean }[] = [];
    for (const path of paths) {
      try {
        const response = await fetch(`app://watchlist${path}`);
        out.push({
          status: response.status,
          leaked: (await response.text()).includes('@movie-watchlist/desktop'),
        });
      } catch {
        out.push({ status: 0, leaked: false });
      }
    }
    return out;
  });
  for (const body of bodies) expect(body.leaked).toBe(false);
});
