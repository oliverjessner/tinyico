import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeIco, parseIco, decodeIco, extractIco } from '../dist/index.js';
import { png, pattern, pixels, offsetView, chunk } from './fixtures/helpers.mjs';

test('embeds multiple PNGs byte-for-byte, including 256 dimension bytes', () => {
  const buffers = [png(16, 16), png(32, 32), png(256, 256), png(20, 7)];
  const output = encodeIco(buffers.map(buffer => ({ buffer: offsetView(buffer) })));
  assert.ok(Buffer.isBuffer(output));
  assert.equal(output[6 + 2 * 16], 0);
  assert.equal(output[6 + 2 * 16 + 1], 0);
  assert.deepEqual(decodeIco(output).map(image => image.buffer), buffers);
  assert.equal(output.length, 6 + 16 * buffers.length + buffers.reduce((sum, buffer) => sum + buffer.length, 0));
});

for (const format of ['png', 'dib']) {
  for (const [width, height] of [[1, 1], [3, 2], [17, 5], [256, 256], [256, 1], [1, 256]]) {
    test(`RGBA to ${format} ${width}x${height}: exact pixel and alpha roundtrip`, () => {
      const rgba = pattern(width, height);
      const copy = Buffer.from(rgba);
      const encoded = encodeIco([{ rgba: offsetView(rgba), width, height }], { format });
      assert.equal(parseIco(encoded).images[0].format, format);
      const decoded = pixels(extractIco(offsetView(encoded)));
      assert.deepEqual(decoded.rgba, rgba);
      assert.equal(decoded.width, width);
      assert.equal(decoded.height, height);
      assert.deepEqual(rgba, copy);
    });
  }

  test(`${format} preserves fully transparent pixels and hidden RGB`, () => {
    const rgba = Buffer.from([12, 34, 56, 0, 78, 90, 123, 0]);
    const encoded = encodeIco([{ rgba, width: 2, height: 1 }], { format });
    assert.deepEqual(pixels(extractIco(encoded)).rgba, rgba);
  });

  test(`${format} CUR roundtrip with bounds-edge hotspots`, () => {
    const rgba = pattern(7, 3);
    const hotspot = { x: 6, y: 2 };
    const cur = encodeIco([{ rgba, width: 7, height: 3, hotspot }], { type: 'cur', format });
    assert.equal(parseIco(cur).type, 'cur');
    assert.deepEqual(decodeIco(cur)[0].hotspot, hotspot);
    assert.deepEqual(pixels(extractIco(cur)).rgba, rgba);
  });
}

test('PNG inputs preserve ancillary color data and interlacing', () => {
  const input = png(1, 1, undefined, { interlace: 1, before: [chunk('gAMA', Buffer.from([0, 0, 177, 143]))] });
  assert.deepEqual(extractIco(encodeIco([{ buffer: input }])), input);
});

test('PNG and RGBA inputs can be mixed for PNG output', () => {
  const a = png(3, 2), rgba = pattern(4, 5);
  const out = decodeIco(encodeIco([{ buffer: a }, { rgba, width: 4, height: 5 }]));
  assert.deepEqual(out[0].buffer, a);
  assert.deepEqual(pixels(out[1].buffer).rgba, rgba);
});

test('validates image inputs, formats and hotspot semantics', () => {
  const valid = { rgba: pattern(2, 2), width: 2, height: 2 };
  for (const images of [[], null, {}, new Array(257).fill(valid), [null], [{}],
    [{ ...valid, width: 0 }], [{ ...valid, height: 257 }], [{ ...valid, width: 1.2 }],
    [{ ...valid, rgba: Buffer.alloc(15) }], [{ ...valid, rgba: Buffer.alloc(17) }],
    [{ ...valid, buffer: png(2, 2) }], [{ buffer: Buffer.from('not png') }], [{ buffer: new DataView(new ArrayBuffer(40)) }]]) {
    assert.throws(() => encodeIco(images), /tinyico:/);
  }
  for (const options of [{ type: 'ani' }, { format: 'jpeg' }]) assert.throws(() => encodeIco([valid], options), /tinyico:/);
  assert.throws(() => encodeIco([{ buffer: png(2, 2) }], { format: 'dib' }), /requires RGBA/);
  assert.throws(() => encodeIco([{ ...valid, hotspot: { x: 0, y: 0 } }]), /type cur/);
  for (const hotspot of [undefined, null, {}, { x: -1, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 0 }, { x: 0.5, y: 0 }, { x: NaN, y: 0 }]) {
    assert.throws(() => encodeIco([{ ...valid, hotspot }], { type: 'cur' }), /hotspot/);
  }
});

test('maximum image count is usable within the pixel budget', () => {
  const input = Array.from({ length: 256 }, () => ({ rgba: pattern(1, 1), width: 1, height: 1 }));
  assert.equal(decodeIco(encodeIco(input)).length, 256);
});
