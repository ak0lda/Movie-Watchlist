import { FakeWebDavServer } from '@movie-watchlist/core/testing';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SecretCrypto } from '../src/main/secretStore';

export async function makeTempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mw-desktop-'));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const canonicalHeader = (name: string) =>
  name
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('-');

export interface RunningServer {
  url: string;
  close(): Promise<void>;
}

/** Serves a FakeWebDavServer over real HTTP on a random loopback port. */
export async function serveWebDav(fake: FakeWebDavServer): Promise<RunningServer> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') headers[canonicalHeader(name)] = value;
      }
      const address = server.address() as AddressInfo;
      void fake
        .request({
          method: req.method ?? 'GET',
          url: `http://127.0.0.1:${address.port}${req.url ?? '/'}`,
          headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
        .then(
          (response) => {
            res.writeHead(response.status, response.headers);
            res.end(response.body);
          },
          () => {
            res.destroy();
          },
        );
    });
  });
  return listen(server);
}

/** A raw server with a custom handler (redirects, hangs, oversized answers). */
export function serveRaw(handler: Parameters<typeof createServer>[1]): Promise<RunningServer> {
  return listen(createServer(handler));
}

async function listen(server: Server): Promise<RunningServer> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Reversible stand-in for safeStorage: the output never contains the plain text. */
export class FakeCrypto implements SecretCrypto {
  available = true;
  shouldReEncrypt = false;
  encryptCalls = 0;

  isAvailable(): Promise<boolean> {
    return Promise.resolve(this.available);
  }

  encrypt(plain: string): Promise<Uint8Array> {
    this.encryptCalls += 1;
    const bytes = Buffer.from(plain, 'utf8').map((byte) => byte ^ 0x5a);
    return Promise.resolve(Buffer.concat([Buffer.from('ENC1'), bytes]));
  }

  decrypt(data: Uint8Array): Promise<{ result: string; shouldReEncrypt: boolean }> {
    const buffer = Buffer.from(data);
    if (buffer.subarray(0, 4).toString() !== 'ENC1') return Promise.reject(new Error('bad blob'));
    const plain = Buffer.from(buffer.subarray(4).map((byte) => byte ^ 0x5a)).toString('utf8');
    return Promise.resolve({ result: plain, shouldReEncrypt: this.shouldReEncrypt });
  }
}
