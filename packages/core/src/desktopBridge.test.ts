import { describe, expect, it } from 'vitest';
import {
  deserializeSyncError,
  fail,
  ok,
  serializeSyncError,
  toBridgeResult,
  unwrapBridgeResult,
} from './desktopBridge';
import {
  AuthError,
  ConfigError,
  ConflictError,
  NetworkError,
  SchemaError,
  StorageError,
  SyncError,
} from './errors';

const TYPED: [string, SyncError][] = [
  ['network', new NetworkError('offline')],
  ['auth', new AuthError('denied')],
  ['conflict', new ConflictError('412')],
  ['storage', new StorageError('quota')],
  ['config', new ConfigError('bad url')],
  ['schema invalid', new SchemaError('invalid', 'broken')],
  ['schema newer', new SchemaError('newer-version', 'too new', { foundVersion: 7 })],
];

describe('error serialization', () => {
  it.each(TYPED)('round-trips %s', (_name, error) => {
    const rebuilt = deserializeSyncError(serializeSyncError(error));
    expect(rebuilt.constructor).toBe(error.constructor);
    expect(rebuilt.code).toBe(error.code);
    expect(rebuilt.message).toBe(error.message);
    if (error instanceof SchemaError) {
      const schema = rebuilt as SchemaError;
      expect(schema.reason).toBe(error.reason);
      expect(schema.foundVersion).toBe(error.foundVersion);
    }
  });

  it('never forwards the text of unknown errors', () => {
    const secret = new Error('Authorization: Basic c2VjcmV0');
    const serialized = serializeSyncError(secret);
    expect(JSON.stringify(serialized)).not.toContain('c2VjcmV0');
    expect(serialized.code).toBe('network');
  });

  it('survives a JSON structured-clone-like round trip', () => {
    const wire = JSON.parse(
      JSON.stringify(
        serializeSyncError(new SchemaError('newer-version', 'x', { foundVersion: 3 })),
      ),
    );
    expect(deserializeSyncError(wire)).toBeInstanceOf(SchemaError);
  });
});

describe('BridgeResult helpers', () => {
  it('wraps values and errors', async () => {
    expect(await toBridgeResult(() => Promise.resolve(5))).toEqual(ok(5));
    const failed = await toBridgeResult(() => Promise.reject(new AuthError('no')));
    expect(failed).toEqual(fail(new AuthError('no')));
  });

  it('unwrap returns values and throws rebuilt typed errors', () => {
    expect(unwrapBridgeResult(ok('v'))).toBe('v');
    expect(() => unwrapBridgeResult(fail(new ConflictError('c')))).toThrow(ConflictError);
  });
});
