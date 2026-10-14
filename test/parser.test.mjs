import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parseIco, isIco } from '../dist/index.js';
import { dib, ico, pngEntry, offsetView } from './fixtures/helpers.mjs';

test('parses the fixed ICO fixture and PNG/DIB metadata in directory order', () => {
  const data = readFileSync(new URL('./fixtures/mixed.ico', import.meta.url));
  const metadata = parseIco(data);
  assert.equal(metadata.type, 'ico');
  assert.equal(metadata.count, 3);
  assert.deepEqual(metadata.images.map(({ width, height, bitDepth, format }) =>
    [width, height, bitDepth, format]), [[16, 16, 32, 'png'], [7, 3, 4, 'dib'], [256, 256, 32, 'png']]);
  for (const [i, image] of metadata.images.entries()) {
    assert.equal(image.index, i);
    assert.equal(image.offset, data.readUInt32LE(6 + i * 16 + 12));
    assert.equal(image.size, data.readUInt32LE(6 + i * 16 + 8));
  }
});

for (const depth of [1, 4, 8, 24, 32]) {
  test(`reads ${depth}-bit DIB without decoding pixels`, () => {
    const image = dib(9, 5, depth);
    assert.equal(parseIco(ico([image])).images[0].bitDepth, depth);
  });
}

test('CUR preserves nonzero hotspots and reports payload bit depth', () => {
  const image = { ...pngEntry(32, 16), hotspot: { x: 31, y: 15 } };
  const parsed = parseIco(ico([image], 'cur'));
  assert.equal(parsed.type, 'cur');
  assert.deepEqual(parsed.images[0].hotspot, image.hotspot);
  assert.equal(parsed.images[0].bitDepth, 32);
});

test('supports Uint8Array, sliced Buffer, and cross-realm Uint8Array byte offsets', () => {
  const data = ico([pngEntry(4, 2)]);
  const view = offsetView(data);
  assert.deepEqual(parseIco(view), parseIco(data));
  assert.deepEqual(parseIco(Buffer.from(view.buffer, view.byteOffset, view.byteLength)), parseIco(data));
  const crossRealm = runInNewContext('new Uint8Array(input)', { input: [...data] });
  assert.deepEqual(parseIco(crossRealm), parseIco(data));
  assert.equal(isIco(crossRealm), true);
});

test('isIco is a nonthrowing header-only predicate for ICO and CUR', () => {
  for (const value of [undefined, null, {}, '', [], new Uint16Array(6), new DataView(new ArrayBuffer(6)),
    ...Array.from({ length: 6 }, (_, n) => Buffer.alloc(n)), Buffer.from([0, 0, 3, 0, 1, 0]), Buffer.from([0, 0, 1, 0, 0, 0])]) {
    assert.equal(isIco(value), false);
  }
  assert.equal(isIco(Buffer.from([0, 0, 1, 0, 1, 0])), true);
  assert.equal(isIco(Buffer.from([0, 0, 2, 0, 1, 0])), true);
  assert.equal(isIco(offsetView(ico([pngEntry(1)]))), true);
});

test('accepts unspecified directory hints and PNG bit-depth hints', () => {
  const data = ico([dib(2, 2, 4)]);
  data.writeUInt16LE(0, 10); data.writeUInt16LE(0, 12);
  assert.equal(parseIco(data).images[0].bitDepth, 4);
  const pngData = ico([pngEntry(2)]);
  pngData.writeUInt16LE(24, 12);
  assert.equal(parseIco(pngData).images[0].bitDepth, 32);
});

test('ranges can be out of order and separated by padding', () => {
  const a = pngEntry(2), b = pngEntry(4);
  const source = ico([a, b]);
  source.writeUInt32LE(38, 34);
  b.buffer.copy(source, 38); a.buffer.copy(source, 38 + b.buffer.length);
  source.writeUInt32LE(38 + b.buffer.length, 18);
  assert.deepEqual(parseIco(source).images.map(image => image.width), [2, 4]);
  const one = ico([a]);
  const padded = Buffer.concat([one.subarray(0, 22), Buffer.alloc(11), one.subarray(22)]);
  padded.writeUInt32LE(33, 18);
  assert.equal(parseIco(padded).images[0].offset, 33);
});
