import { NetworkError } from '@movie-watchlist/core';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_RESPONSE_BYTES, createFetchTransport, type FetchLike } from '../src/main/netTransport';
import { serveRaw, type RunningServer } from './helpers';

const servers: RunningServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});
async function serve(handler: Parameters<typeof serveRaw>[0]) {
  const server = await serveRaw(handler);
  servers.push(server);
  return server;
}
const realFetch = fetch as unknown as FetchLike;

describe('createFetchTransport', () => {
  it('sends method, headers and body and returns status, lower-cased headers and UTF-8 text', async () => {
    let seen: { method?: string | undefined; auth?: string | undefined; body: string } = {
      body: '',
    };
    const server = await serve((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        seen = {
          method: req.method,
          auth: req.headers.authorization,
          body: Buffer.concat(chunks).toString('utf8'),
        };
        res.writeHead(201, { ETag: '"abc"', 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('ответ 🎬');
      });
    });
    const response = await createFetchTransport(realFetch).request({
      method: 'PUT',
      url: `${server.url}/f`,
      headers: { Authorization: 'Basic eA==' },
      body: 'тело',
    });
    expect(seen).toEqual({ method: 'PUT', auth: 'Basic eA==', body: 'тело' });
    expect(response.status).toBe(201);
    expect(response.headers['etag']).toBe('"abc"');
    expect(response.body).toBe('ответ 🎬');
  });

  it('does NOT follow redirects, so credentials never reach another host', async () => {
    let otherHits = 0;
    const other = await serve((_req, res) => {
      otherHits += 1;
      res.end('secret place');
    });
    const origin = await serve((_req, res) => {
      res.writeHead(302, { Location: `${other.url}/stolen` });
      res.end();
    });
    const response = await createFetchTransport(realFetch).request({
      method: 'GET',
      url: `${origin.url}/f`,
      headers: { Authorization: 'Basic eA==' },
    });
    expect(response.status).toBe(302);
    expect(otherHits).toBe(0);
  });

  it('turns a hanging server into a NetworkError after the timeout', async () => {
    const server = await serve(() => {
      // never answers
    });
    const started = Date.now();
    const error = await createFetchTransport(realFetch, 150)
      .request({ method: 'GET', url: server.url, headers: {} })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('turns a refused connection into a NetworkError', async () => {
    const server = await serve((_req, res) => res.end());
    const url = server.url;
    await server.close();
    servers.length = 0;
    await expect(
      createFetchTransport(realFetch).request({ method: 'GET', url, headers: {} }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('rejects oversized responses by declared length and by actual size', async () => {
    const headers = (length: string) => ({ forEach: () => undefined, get: () => length });
    const declared: FetchLike = () =>
      Promise.resolve({
        status: 200,
        headers: headers(String(MAX_RESPONSE_BYTES + 1)),
        text: () => Promise.resolve(''),
      });
    await expect(
      createFetchTransport(declared).request({ method: 'GET', url: 'http://x', headers: {} }),
    ).rejects.toBeInstanceOf(NetworkError);

    const lying: FetchLike = () =>
      Promise.resolve({
        status: 200,
        headers: headers('5'),
        text: () => Promise.resolve('я'.repeat(MAX_RESPONSE_BYTES / 2 + 1)),
      });
    await expect(
      createFetchTransport(lying).request({ method: 'GET', url: 'http://x', headers: {} }),
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('wraps a failing body read', async () => {
    const broken: FetchLike = () =>
      Promise.resolve({
        status: 200,
        headers: { forEach: () => undefined, get: () => null },
        text: () => Promise.reject(new TypeError('terminated')),
      });
    await expect(
      createFetchTransport(broken).request({ method: 'GET', url: 'http://x', headers: {} }),
    ).rejects.toBeInstanceOf(NetworkError);
  });
});
