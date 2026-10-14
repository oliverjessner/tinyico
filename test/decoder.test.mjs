import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractIco, decodeIco, parseIco } from '../dist/index.js';
import { dib, ico, pngEntry, png, pixels, pattern, offsetView, chunk } from './fixtures/helpers.mjs';

for (const depth of [1, 4, 8, 24, 32]) {
  for (const [width, height] of [[1, 1], [3, 2], [9, 5], [33, 3]]) {
    test(`decodes ${depth}-bit ${width}x${height} DIB pixels, row padding and AND/alpha`, () => {
      const fixture = dib(width, height, depth);
      // For a single transparent 32-bit pixel the all-zero-alpha fallback uses AND.
      const out = decodeIco(offsetView(ico([fixture])))[0];
      assert.equal(out.format, 'dib');
      assert.deepEqual(pixels(out.buffer).rgba, fixture.expected);
    });
  }
}

test('all-zero 32-bit alpha uses AND mask; meaningful alpha overrides AND', () => {
  for (const alpha of ['unused', 'meaningful']) {
    const fixture = dib(7, 3, 32, { alpha, mask: () => true });
    assert.deepEqual(pixels(extractIco(ico([fixture]))).rgba, fixture.expected);
  }
});

test('32-bit alpha works without an AND mask when alpha is meaningful', () => {
  const fixture = dib(5, 2, 32, { omitMask: true });
  assert.deepEqual(pixels(extractIco(ico([fixture]))).rgba, fixture.expected);
});

test('all-zero 32-bit alpha without an AND mask is rejected', () => {
  assert.throws(() => extractIco(ico([dib(2, 2, 32, { omitMask: true, alpha: 'unused' })])), /AND mask/);
});

test('all-opaque alpha is meaningful, and palette reserved bytes are ignored', () => {
  const fixture = dib(7, 2, 32, { rgba: pattern(7, 2, false), mask: () => true });
  assert.deepEqual(pixels(extractIco(ico([fixture]))).rgba, fixture.expected);
  const indexed = dib(7, 2, 8, { used: 4 });
  assert.deepEqual(pixels(extractIco(ico([indexed]))).rgba, indexed.expected);
});

test('PNG passthrough returns identical bytes and shares input memory', () => {
  const fixture = pngEntry(8);
  const input = offsetView(ico([fixture]));
  const out = extractIco(input);
  const entry = parseIco(input).images[0];
  assert.deepEqual(out, fixture.buffer);
  assert.equal(out.buffer, input.buffer);
  assert.equal(out.byteOffset, input.byteOffset + entry.offset);
  assert.equal(decodeIco(input)[0].buffer.buffer, input.buffer);
});

test('PNG passthrough preserves interlace, indexed, grayscale and 16-bit RGB', () => {
  const fixtures = [
    png(1, 1, Buffer.from([10, 20, 30, 40]), { interlace: 1 }),
    png(2, 1, undefined, { depth: 1, color: 3, scanlines: Buffer.from([0, 0b01000000]), palette: Buffer.from([255, 0, 0, 0, 255, 0]), after: [chunk('tEXt', Buffer.from('key\0value'))] }),
    png(2, 1, undefined, { depth: 4, color: 0, scanlines: Buffer.from([0, 0x2f]) }),
    png(1, 1, undefined, { depth: 16, color: 2, scanlines: Buffer.from([0, 0, 1, 0, 2, 0, 3]) }),
  ];
  fixtures.forEach((buffer, i) => {
    const width = i === 1 || i === 2 ? 2 : 1;
    assert.deepEqual(extractIco(ico([{ buffer, width, height: 1 }])), buffer);
  });
});

for (const [color, channels, depths] of [[0, 1, [1, 2, 4, 8, 16]], [2, 3, [8, 16]],
  [3, 1, [1, 2, 4, 8]], [4, 2, [8, 16]], [6, 4, [8, 16]]]) {
  for (const depth of depths) {
    test(`PNG color type ${color} / sample depth ${depth} passes through encoding and decoding`, async () => {
      const { encodeIco } = await import('../dist/index.js');
      const scanlines = Buffer.alloc(1 + Math.ceil(2 * channels * depth / 8));
      const buffer = png(2, 1, undefined, { color, depth, scanlines,
        ...(color === 3 ? { palette: Buffer.from([1, 2, 3]) } : {}) });
      const container = encodeIco([{ buffer: offsetView(buffer) }]);
      assert.equal(parseIco(container).images[0].bitDepth, channels * depth);
      assert.deepEqual(extractIco(container), buffer);
    });
  }
}

test('extracts by index and deterministic size selection without scaling', () => {
  const source = ico([pngEntry(16), pngEntry(64), pngEntry(32), pngEntry(48, 24)]);
  const dimensions = options => pixels(extractIco(source, options)).width;
  assert.equal(dimensions(), 16);
  assert.equal(dimensions({ index: 1 }), 64);
  assert.equal(dimensions({ size: 32 }), 32);
  assert.equal(dimensions({ size: 17 }), 32);
  assert.equal(dimensions({ size: 100 }), 64);
  assert.equal(dimensions({ size: { width: 48, height: 24 } }), 48);
  assert.deepEqual(extractIco(source, { size: { width: 48, height: 24 } }), pngEntry(48, 24).buffer);
});

test('size ties prefer bit depth then directory order', () => {
  const low = dib(3, 3, 4), high = pngEntry(3), later = pngEntry(3);
  assert.deepEqual(extractIco(ico([low, high, later]), { size: 3 }), high.buffer);
  const first = png(3, 3, pattern(3, 3, false));
  assert.deepEqual(extractIco(ico([{ ...high, buffer: first }, high]), { size: 3 }), first);
});

test('extract only processes selected image pixels / PNG chunks', () => {
  const good = pngEntry(3);
  const bad = pngEntry(4);
  bad.buffer[bad.buffer.length - 1] ^= 1; // IEND CRC, not IHDR.
  const source = ico([good, bad]);
  assert.equal(parseIco(source).count, 2);
  assert.deepEqual(extractIco(source, { index: 0 }), good.buffer);
  assert.throws(() => decodeIco(source), /CRC/);
  const invalidPalette = dib(2, 2, 4, { used: 2 });
  invalidPalette.buffer[48] = 0xff;
  const lazy = ico([good, invalidPalette]);
  assert.deepEqual(extractIco(lazy), good.buffer);
  assert.throws(() => decodeIco(lazy), /palette entry/);
});

test('all decoded CUR entries retain hotspots and original metadata', () => {
  const fixture = readFileSync(new URL('./fixtures/cursor.cur', import.meta.url));
  const result = decodeIco(fixture);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(image => image.hotspot), [{ x: 2, y: 3 }, { x: 0, y: 0 }]);
  result.forEach(({ buffer, ...metadata }, i) => assert.deepEqual(metadata, parseIco(fixture).images[i]));
});

test('rejects invalid and conflicting selectors', () => {
  const source = ico([pngEntry(2)]);
  for (const options of [{ index: -1 }, { index: 1 }, { index: 0.1 }, { index: NaN }, { index: '0' },
    { size: 0 }, { size: 257 }, { size: NaN }, { size: '2' }, { size: null }, { size: {} },
    { size: { width: 1, height: -1 } }, { index: 0, size: 2 }]) {
    assert.throws(() => extractIco(source, options), /tinyico:/);
  }
});
