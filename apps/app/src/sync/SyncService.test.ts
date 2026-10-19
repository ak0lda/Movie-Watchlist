import {
  AuthError,
  ConfigError,
  ConflictError,
  NetworkError,
  SchemaError,
} from '@movie-watchlist/core';
import { describe, expect, it, vi } from 'vitest';
import { FakeRunner } from '../testing/helpers';
import { SyncService, type SyncStatus, type VisibilitySource } from './SyncService';

class FakeDocument implements VisibilitySource {
  visibilityState = 'visible';
  private readonly listeners = new Set<() => void>();
  addEventListener(_type: 'visibilitychange', listener: () => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: 'visibilitychange', listener: () => void) {
    this.listeners.delete(listener);
  }
  setVisibility(state: string) {
    this.visibilityState = state;
    this.listeners.forEach((listener) => listener());
  }
  get listenerCount() {
    return this.listeners.size;
  }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const runner = new FakeRunner();
  const service = new SyncService(runner, () => 1234);
  const seen: SyncStatus[] = [];
  service.subscribe(() => seen.push(service.getStatus()));
  return { runner, service, seen };
}

describe('syncNow', () => {
  it('starts idle, goes syncing, then synced with the clock time', async () => {
    const { service, seen } = setup();
    expect(service.getStatus()).toEqual({ kind: 'idle' });
    await service.syncNow();
    expect(seen).toEqual([{ kind: 'syncing' }, { kind: 'synced', at: 1234 }]);
  });

  it('shows syncing while the run is in flight', async () => {
    const { service, runner } = setup();
    let release!: () => void;
    runner.gate = new Promise<void>((resolve) => (release = resolve));
    const run = service.syncNow();
    await tick();
    expect(service.getStatus()).toEqual({ kind: 'syncing' });
    release();
    await run;
    expect(service.getStatus().kind).toBe('synced');
  });

  it.each([
    [new AuthError(), 'errors.sync.auth'],
    [new NetworkError(), 'errors.sync.network'],
    [new ConflictError(), 'errors.sync.conflict'],
    [new SchemaError('newer-version', 'x'), 'errors.schema.newerVersion'],
    [new ConfigError(), 'errors.sync.config'],
    [new Error('boom'), 'errors.unknown'],
  ])('maps %s to a translation key on a manual sync', async (error, key) => {
    const { service, runner } = setup();
    runner.error = error;
    await service.syncNow('manual');
    expect(service.getStatus()).toEqual({ kind: 'error', key });
  });

  it('never rejects, even for non-error throws', async () => {
    const { service, runner } = setup();
    runner.error = 'a string';
    await expect(service.syncNow()).resolves.toBeUndefined();
    expect(service.getStatus().kind).toBe('error');
  });

  it('recovers after an error', async () => {
    const { service, runner } = setup();
    runner.error = new NetworkError();
    await service.syncNow();
    runner.error = undefined;
    await service.syncNow();
    expect(service.getStatus().kind).toBe('synced');
  });

  it('stays quiet about "not configured" for automatic triggers but reports it for the button', async () => {
    for (const reason of ['startup', 'hidden'] as const) {
      const { service, runner } = setup();
      runner.error = new ConfigError('Sync is not configured');
      await service.syncNow(reason);
      expect(service.getStatus()).toEqual({ kind: 'idle' });
    }
    const { service, runner } = setup();
    runner.error = new ConfigError('Sync is not configured');
    await service.syncNow('manual');
    expect(service.getStatus()).toEqual({ kind: 'error', key: 'errors.sync.config' });
  });

  it('still reports real failures from automatic triggers', async () => {
    const { service, runner } = setup();
    runner.error = new AuthError();
    await service.syncNow('startup');
    expect(service.getStatus()).toEqual({ kind: 'error', key: 'errors.sync.auth' });
  });

  it('lets subscribers unsubscribe', async () => {
    const { service } = setup();
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);
    unsubscribe();
    await service.syncNow();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('start (automatic triggers)', () => {
  it('syncs once at startup', async () => {
    const { service, runner } = setup();
    service.start(new FakeDocument());
    await tick();
    expect(runner.calls).toBe(1);
  });

  it('syncs when the window goes to the background (minimise) and not when it returns', async () => {
    const { service, runner } = setup();
    const doc = new FakeDocument();
    service.start(doc);
    await tick();
    doc.setVisibility('hidden');
    await tick();
    expect(runner.calls).toBe(2);
    doc.setVisibility('visible');
    await tick();
    expect(runner.calls).toBe(2);
    doc.setVisibility('hidden');
    await tick();
    expect(runner.calls).toBe(3);
  });

  it('stops reacting after the disposer is called', async () => {
    const { service, runner } = setup();
    const doc = new FakeDocument();
    const dispose = service.start(doc);
    await tick();
    expect(doc.listenerCount).toBe(1);
    dispose();
    expect(doc.listenerCount).toBe(0);
    doc.setVisibility('hidden');
    await tick();
    expect(runner.calls).toBe(1);
  });

  it('also syncs when the shell reports a minimised or hidden window', async () => {
    const { service, runner } = setup();
    let notify: () => void = () => undefined;
    let unsubscribed = 0;
    const dispose = service.start(new FakeDocument(), (listener) => {
      notify = listener;
      return () => {
        unsubscribed += 1;
      };
    });
    await tick();
    expect(runner.calls).toBe(1);
    notify();
    await tick();
    notify();
    await tick();
    expect(runner.calls).toBe(3);
    dispose();
    expect(unsubscribed).toBe(1);
  });

  it('does not show an error for an unconfigured app at startup', async () => {
    const { service, runner } = setup();
    runner.error = new ConfigError('Sync is not configured');
    service.start(new FakeDocument());
    await tick();
    expect(service.getStatus()).toEqual({ kind: 'idle' });
  });
});
