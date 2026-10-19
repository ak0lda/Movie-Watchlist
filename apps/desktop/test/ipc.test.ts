import {
  AuthError,
  ConfigError,
  DESKTOP_API_METHODS,
  type SyncConfigInput,
  type SyncConfigView,
} from '@movie-watchlist/core';
import { describe, expect, it } from 'vitest';
import { createHandlers, type IpcSender } from '../src/main/ipc';
import type { SyncBackend } from '../src/main/syncBackend';
import { CHANNELS } from '../src/shared/channels';

const ORIGIN = 'app://watchlist';
const TRUSTED: IpcSender = { url: `${ORIGIN}/index.html`, isMainFrame: true };
const VIEW: SyncConfigView = {
  serverUrl: 'https://dav.example',
  filePath: '/a.json',
  login: 'u',
  hasPassword: true,
};

class RecordingBackend implements SyncBackend {
  calls: { method: string; args: unknown[] }[] = [];
  failWith: unknown;
  private record<T>(method: string, args: unknown[], value: T): Promise<T> {
    this.calls.push({ method, args });
    return this.failWith === undefined ? Promise.resolve(value) : Promise.reject(this.failWith);
  }
  getConfigView() {
    return this.record('getConfigView', [], VIEW);
  }
  saveConfig(input: SyncConfigInput) {
    return this.record('saveConfig', [input], VIEW);
  }
  clearPassword() {
    return this.record('clearPassword', [], { ...VIEW, hasPassword: false });
  }
  download() {
    return this.record('download', [], { kind: 'not-found' as const });
  }
  upload(data: string, etag: string | null) {
    return this.record('upload', [data, etag], { etag: '"new"' });
  }
}

function setup() {
  const backend = new RecordingBackend();
  const handlers = createHandlers(backend, { trustedOrigin: ORIGIN, allowInsecureLoopback: false });
  return { backend, handlers };
}

const VALID_SAVE = {
  serverUrl: 'https://dav.example',
  filePath: '/a/b.json',
  login: 'user',
  password: 'pw',
};
const VALID_CALLS: [keyof typeof CHANNELS, unknown[]][] = [
  ['getConfig', []],
  ['saveConfig', [VALID_SAVE]],
  ['clearPassword', []],
  ['download', []],
  ['upload', ['{}', null]],
];

describe('channels', () => {
  it('expose exactly the documented API surface', () => {
    expect(Object.keys(CHANNELS).sort()).toEqual([
      'clearPassword',
      'download',
      'getConfig',
      'saveConfig',
      'upload',
    ]);
    expect(DESKTOP_API_METHODS.map((m) => m.replace('sync.', '')).sort()).toEqual(
      Object.keys(CHANNELS).sort(),
    );
    expect(
      Object.keys(
        createHandlers(new RecordingBackend(), {
          trustedOrigin: ORIGIN,
          allowInsecureLoopback: false,
        }),
      ),
    ).toHaveLength(5);
  });
});

describe('sender trust', () => {
  const UNTRUSTED: IpcSender[] = [
    { url: 'https://evil.example/', isMainFrame: true },
    { url: 'app://watchlist.evil.com/', isMainFrame: true },
    { url: 'file:///C:/x.html', isMainFrame: true },
    { url: `${ORIGIN}/index.html`, isMainFrame: false },
    { url: undefined, isMainFrame: true },
  ];

  it.each(VALID_CALLS)(
    '%s refuses untrusted callers without touching the backend',
    async (name, args) => {
      const { backend, handlers } = setup();
      for (const sender of UNTRUSTED) {
        const result = await handlers[CHANNELS[name]](sender, ...args);
        expect(result).toMatchObject({ ok: false, error: { code: 'config' } });
      }
      expect(backend.calls).toEqual([]);
    },
  );

  it.each(VALID_CALLS)('%s serves the trusted page', async (name, args) => {
    const { backend, handlers } = setup();
    const result = await handlers[CHANNELS[name]](TRUSTED, ...args);
    expect(result.ok).toBe(true);
    expect(backend.calls).toHaveLength(1);
  });
});

describe('argument validation', () => {
  it('rejects extra arguments on no-argument channels', async () => {
    const { backend, handlers } = setup();
    for (const channel of [CHANNELS.getConfig, CHANNELS.clearPassword, CHANNELS.download]) {
      expect(await handlers[channel](TRUSTED, 'x')).toMatchObject({
        ok: false,
        error: { code: 'config' },
      });
    }
    expect(backend.calls).toEqual([]);
  });

  it.each([
    [[]],
    [[VALID_SAVE, 'extra']],
    [[{ ...VALID_SAVE, serverUrl: 'http://dav.example' }]],
    [[{ ...VALID_SAVE, filePath: '/../x' }]],
    [['not an object']],
  ])('saveConfig rejects %j', async (args) => {
    const { backend, handlers } = setup();
    expect(await handlers[CHANNELS.saveConfig](TRUSTED, ...args)).toMatchObject({
      ok: false,
      error: { code: 'config' },
    });
    expect(backend.calls).toEqual([]);
  });

  it.each([[[]], [['{}']], [[5, null]], [['{}', 'a\r\nb']], [['{}', null, 'extra']]])(
    'upload rejects %j',
    async (args) => {
      const { backend, handlers } = setup();
      expect(await handlers[CHANNELS.upload](TRUSTED, ...args)).toMatchObject({
        ok: false,
        error: { code: 'config' },
      });
      expect(backend.calls).toEqual([]);
    },
  );

  it('passes only the validated, cleaned config to the backend', async () => {
    const { backend, handlers } = setup();
    await handlers[CHANNELS.saveConfig](TRUSTED, {
      ...VALID_SAVE,
      evil: 'x',
      serverUrl: '  https://dav.example  ',
    });
    expect(backend.calls[0]?.args[0]).toEqual({ ...VALID_SAVE, serverUrl: 'https://dav.example' });
  });

  it('allows loopback http only when the option is on', async () => {
    const backend = new RecordingBackend();
    const strict = createHandlers(backend, { trustedOrigin: ORIGIN, allowInsecureLoopback: false });
    const lenient = createHandlers(backend, { trustedOrigin: ORIGIN, allowInsecureLoopback: true });
    const input = { ...VALID_SAVE, serverUrl: 'http://127.0.0.1:9000' };
    expect((await strict[CHANNELS.saveConfig](TRUSTED, input)).ok).toBe(false);
    expect((await lenient[CHANNELS.saveConfig](TRUSTED, input)).ok).toBe(true);
  });
});

describe('error handling', () => {
  it('forwards typed errors as serialized results', async () => {
    const { backend, handlers } = setup();
    backend.failWith = new AuthError('denied');
    expect(await handlers[CHANNELS.download](TRUSTED)).toEqual({
      ok: false,
      error: { code: 'auth', message: 'denied' },
    });
    backend.failWith = new ConfigError('bad');
    expect(await handlers[CHANNELS.getConfig](TRUSTED)).toMatchObject({
      ok: false,
      error: { code: 'config' },
    });
  });

  it('hides the text of unexpected errors (they may contain secrets)', async () => {
    const { backend, handlers } = setup();
    backend.failWith = new Error('Authorization: Basic c2VjcmV0 for user@example.com');
    const result = await handlers[CHANNELS.upload](TRUSTED, '{}', null);
    expect(JSON.stringify(result)).not.toContain('c2VjcmV0');
    expect(result).toMatchObject({ ok: false, error: { code: 'network' } });
  });

  it('never throws, whatever the backend does', async () => {
    const { backend, handlers } = setup();
    for (const failure of [undefined, 'string', null, 42, { weird: true }, new TypeError('x')]) {
      backend.failWith = failure;
      for (const [name, args] of VALID_CALLS) {
        await expect(handlers[CHANNELS[name]](TRUSTED, ...args)).resolves.toBeDefined();
      }
    }
  });

  it('results never contain a password field', async () => {
    const { handlers } = setup();
    const results = await Promise.all(
      VALID_CALLS.map(([name, args]) => handlers[CHANNELS[name]](TRUSTED, ...args)),
    );
    expect(JSON.stringify(results)).not.toMatch(/"password"/);
    expect(JSON.stringify(results)).not.toContain(VALID_SAVE.password);
  });
});
