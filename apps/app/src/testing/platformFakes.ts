import type { HttpRequest } from '@movie-watchlist/core';
import type { FakeWebDavServer } from '@movie-watchlist/core/testing';
import type { AppStateSource } from '../platform';
import type { SecureStorageLike } from '../platform/native/storage';
import type { WebDavHttpRequest, WebDavHttpResponse } from '../platform/native/webDavHttp';
import type { VisibilitySource } from '../sync/SyncService';

export class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  readonly data = new Map<string, string>();
  getItem = (key: string) => this.data.get(key) ?? null;
  setItem = (key: string, value: string) => void this.data.set(key, value);
}

/** Secure storage stand-in that records what was stored under which key. */
export class FakeSecureStorage implements SecureStorageLike {
  readonly data = new Map<string, string>();
  failSet = false;
  getItem = (key: string) => Promise.resolve(this.data.get(key) ?? null);
  setItem = (key: string, value: string) => {
    if (this.failSet) return Promise.reject(new Error('keystore unavailable'));
    this.data.set(key, value);
    return Promise.resolve();
  };
  removeItem = (key: string) => {
    this.data.delete(key);
    return Promise.resolve();
  };
}

/** The native WebDavHttp plugin backed by an in-memory WebDAV server. */
export class ServerBackedPlugin {
  readonly calls: WebDavHttpRequest[] = [];
  failWith: Error | undefined;

  constructor(private readonly server: FakeWebDavServer) {}

  async request(options: WebDavHttpRequest): Promise<WebDavHttpResponse> {
    this.calls.push(options);
    if (this.failWith) throw this.failWith;
    const request: HttpRequest = {
      method: options.method,
      url: options.url,
      headers: options.headers,
      ...(options.body === undefined ? {} : { body: options.body }),
    };
    const response = await this.server.request(request);
    return { status: response.status, headers: response.headers, body: response.body };
  }
}

export class FakeApp implements AppStateSource {
  private listeners: ((state: { isActive: boolean }) => void)[] = [];
  removed = 0;

  addListener(_event: 'appStateChange', listener: (state: { isActive: boolean }) => void) {
    this.listeners.push(listener);
    return Promise.resolve({
      remove: () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
        this.removed += 1;
        return Promise.resolve();
      },
    });
  }

  setActive(isActive: boolean) {
    this.listeners.forEach((listener) => listener({ isActive }));
  }

  get listenerCount() {
    return this.listeners.length;
  }
}

export class FakeDocument implements VisibilitySource {
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
}

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
