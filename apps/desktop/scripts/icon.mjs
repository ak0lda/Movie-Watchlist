// Writes build/icon.png (512x512): the brand mark, an orange square on black, in the app's Swiss style.
// Run once with `node scripts/icon.mjs`; the PNG is committed so packaging needs no image tools.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SIZE = 512;
const INSET = 128;
const BLACK = [0, 0, 0];
const ACCENT = [0xff, 0x5f, 0x1f];

const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1));
for (let y = 0; y < SIZE; y++) {
  const row = y * (SIZE * 3 + 1);
  raw[row] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const inside = x >= INSET && x < SIZE - INSET && y >= INSET && y < SIZE - INSET;
    const [r, g, b] = inside ? ACCENT : BLACK;
    raw.set([r, g, b], row + 1 + x * 3);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../build/icon.png');
writeFileSync(out, png);
console.log(`wrote ${out}`);
