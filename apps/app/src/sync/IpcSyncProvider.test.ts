import {
  AuthError,
  ConfigError,
  ConflictError,
  NetworkError,
  SchemaError,
  fail,
  ok,
  type DesktopApi,
} from '@movie-watchlist/core';
import { describe, expect, it, vi } from 'vitest';
import { IpcSyncProvider } from './IpcSyncProvider';
import { createSyncSettingsApi } from './syncSettingsApi';

function fakeBridge(overrides: Partial<DesktopApi['sync']> = {}): DesktopApi['sync'] {
  const view = {
    serverUrl: 'https://dav.example',
    filePath: '/a.json',
    login: 'u',
    hasPassword: true,
  };
  return {
    getConfig: () => Promise.resolve(ok(view)),
    saveConfig: () => Promise.resolve(ok(view)),
    clearPassword: () => Promise.resolve(ok({ ...view, hasPassword: false })),
    download: () => Promise.resolve(ok({ kind: 'not-found' as const })),
    upload: () => Promise.resolve(ok({ etag: '"e"' })),
    ...overrides,
  };
}

const thrown = (run: () => Promise<unknown>) =>
  run().then(
    () => undefined,
    (e: unknown) => e,
  );

describe('IpcSyncProvider', () => {
  it('returns download results as they are', async () => {
    const found = { kind: 'found' as const, data: '{}', etag: '"v1"' };
    const provider = new IpcSyncProvider(
      fakeBridge({ download: () => Promise.resolve(ok(found)) }),
    );
    expect(await provider.download()).toEqual(found);
    expect(await new IpcSyncProvider(fakeBridge()).download()).toEqual({ kind: 'not-found' });
  });

  it('forwards upload arguments untouched', async () => {
    const upload = vi.fn(() => Promise.resolve(ok({ etag: '"new"' })));
    const provider = new IpcSyncProvider(fakeBridge({ upload }));
    expect(await provider.upload('data', '"old"')).toEqual({ etag: '"new"' });
    expect(await provider.upload('first', null)).toEqual({ etag: '"new"' });
    expect(upload.mock.calls).toEqual([
      ['data', '"old"'],
      ['first', null],
    ]);
  });

  it.each([
    ['auth', new AuthError('denied'), AuthError],
    ['conflict', new ConflictError('412'), ConflictError],
    ['network', new NetworkError('offline'), NetworkError],
    ['config', new ConfigError('bad'), ConfigError],
    ['schema', new SchemaError('newer-version', 'new', { foundVersion: 4 }), SchemaError],
  ])(
    'rebuilds a typed %s error from the IPC result so the engine can react to it',
    async (_name, error, errorClass) => {
      const provider = new IpcSyncProvider(
        fakeBridge({
          download: () => Promise.resolve(fail(error)),
          upload: () => Promise.resolve(fail(error)),
        }),
      );
      for (const call of [() => provider.download(), () => provider.upload('x', null)]) {
        const rebuilt = await thrown(call);
        expect(rebuilt).toBeInstanceOf(errorClass);
        expect((rebuilt as Error).message).toBe(error.message);
      }
    },
  );

  it('keeps schema details across the bridge', async () => {
    const provider = new IpcSyncProvider(
      fakeBridge({
        download: () =>
          Promise.resolve(fail(new SchemaError('newer-version', 'x', { foundVersion: 9 }))),
      }),
    );
    const error = (await thrown(() => provider.download())) as SchemaError;
    expect(error.reason).toBe('newer-version');
    expect(error.foundVersion).toBe(9);
  });
});

describe('createSyncSettingsApi', () => {
  it('unwraps values and throws typed errors', async () => {
    const api = createSyncSettingsApi(fakeBridge());
    expect((await api.getConfig()).hasPassword).toBe(true);
    expect((await api.clearPassword()).hasPassword).toBe(false);
    const failing = createSyncSettingsApi(
      fakeBridge({ saveConfig: () => Promise.resolve(fail(new ConfigError('no'))) }),
    );
    expect(
      await thrown(() => failing.saveConfig({ serverUrl: 'x', filePath: '/a', login: 'u' })),
    ).toBeInstanceOf(ConfigError);
  });
});
