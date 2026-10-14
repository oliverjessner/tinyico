import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIco, extractIco, decodeIco, encodeIco, isIco } from '../dist/index.js';
import { dib, ico, pngEntry, png, chunk, crc } from './fixtures/helpers.mjs';

const good = ico([pngEntry(3)]);
const rejects = (data, match = /tinyico:/) => {
  assert.throws(() => parseIco(data), match);
  assert.throws(() => extractIco(data), match);
  assert.throws(() => decodeIco(data), match);
};

test('every truncated prefix is rejected by extraction and decoding', () => {
  for (const fixture of [good, ico([dib(3, 2, 1)]), ico([dib(3, 2, 24)]), ico([dib(3, 2, 32)])]) {
    for (let n = 0; n < fixture.length; n++) rejects(fixture.subarray(0, n));
  }
});

test('rejects malformed ICO/CUR headers and directories', () => {
  for (const [offset, value] of [[0, 1], [1, 1], [2, 0], [2, 3], [3, 1], [4, 0], [5, 255], [9, 1]]) {
    const bad = Buffer.from(good); bad[offset] = value; rejects(bad);
  }
  const tooMany = Buffer.from(good); tooMany.writeUInt16LE(257, 4); rejects(tooMany, /count/);
  const depth = Buffer.from(ico([dib(2, 2, 4)])); depth.writeUInt16LE(8, 12); rejects(depth, /bit depth/);
  const planes = Buffer.from(good); planes.writeUInt16LE(2, 10); rejects(planes, /planes/);
});

test('rejects offsets, lengths, directory overlap and overflowing ranges', () => {
  for (const offset of [0, 6, 21, good.length, 0xffffffff]) {
    const bad = Buffer.from(good); bad.writeUInt32LE(offset, 18); rejects(bad);
  }
  for (const size of [0, good.length, 0xffffffff]) {
    const bad = Buffer.from(good); bad.writeUInt32LE(size, 14); rejects(bad);
  }
  const mismatched = Buffer.from(good); mismatched[6] = 4; rejects(mismatched, /dimensions/);
});

test('rejects partially overlapping, contained and identical image ranges', () => {
  const source = ico([pngEntry(3), pngEntry(4)]);
  for (const offset of [38, 39, 38 + source.readUInt32LE(14) - 1]) {
    const bad = Buffer.from(source); bad.writeUInt32LE(offset, 34); rejects(bad, /overlapping/);
  }
});

test('rejects out-of-bounds CUR hotspots', () => {
  const source = ico([pngEntry(3)], 'cur');
  source.writeUInt16LE(3, 10); rejects(source, /hotspot/);
});

test('rejects short image payloads even with adjusted directory length', () => {
  for (const [buffer, max] of [[pngEntry(3).buffer, 33], [dib(3, 2, 8).buffer, 40]]) {
    for (let size = 1; size < max; size++) rejects(ico([{ buffer: buffer.subarray(0, size), width: 3, height: 2 }]));
  }
});

test('rejects malformed DIB headers, palettes, strides, sizes and masks', () => {
  const source = dib(3, 2, 4);
  for (const [offset, value] of [[0, 12], [0, 108], [4, 0], [4, 257], [4, 0x7fffffff],
    [8, 0], [8, 3], [8, 514], [8, 0xfffffffc], [12, 0], [14, 16], [16, 1], [16, 3], [16, 6], [20, 1], [32, 17]]) {
    const bad = Buffer.from(source.buffer); bad.writeUInt32LE(value, offset); rejects(ico([{ ...source, buffer: bad }]));
  }
  for (const size of [40, 41, source.buffer.length - 1, source.buffer.length - 8]) {
    rejects(ico([{ ...source, buffer: source.buffer.subarray(0, size) }]));
  }
  rejects(ico([{ ...source, buffer: Buffer.concat([source.buffer, Buffer.from([1])]) }]), /trailing/);
  const missing = dib(1, 1, 8, { used: 2 }); missing.buffer[48] = 3;
  assert.throws(() => extractIco(ico([missing])), /palette entry/);
});

test('PNG framing, CRCs, critical chunks and IHDR constraints are validated', () => {
  const base = png(2, 2);
  const corruptions = [
    Buffer.concat([base.subarray(0, -12)]),
    Buffer.concat([base, Buffer.from([1])]),
    Buffer.concat([base.subarray(0, 33), chunk('IEND')]),
    Buffer.concat([base.subarray(0, 33), chunk('IDAT'), chunk('IEND')]),
    Buffer.concat([base.subarray(0, 33), chunk('WHAT'), base.subarray(33)]),
    Buffer.concat([base.subarray(0, 33), base.subarray(8, 33), base.subarray(33)]),
    Buffer.concat([base.subarray(0, -12), chunk('IDAT', Buffer.from([1])), chunk('tEXt'), chunk('IDAT', Buffer.from([1])), chunk('IEND')]),
    Buffer.concat([base.subarray(0, 33), chunk('abca'), base.subarray(33)]),
    Buffer.concat([base.subarray(0, 33), chunk('A1CD'), base.subarray(33)]),
  ];
  const hugeChunk = Buffer.from(base); hugeChunk.writeUInt32BE(0xffffffff, 33); corruptions.push(hugeChunk);
  const truncated = Buffer.from(base); truncated.writeUInt32BE(0x7fffffff, 33); corruptions.push(truncated);
  const badCrc = Buffer.from(base); badCrc[badCrc.length - 1] ^= 1; corruptions.push(badCrc);
  for (const [offset, value] of [[8, 12], [12, 0], [16, 0], [16, 257], [20, 257], [24, 3], [25, 5], [26, 1], [27, 1], [28, 2]]) {
    const bad = Buffer.from(base);
    if ([8, 16, 20].includes(offset)) bad.writeUInt32BE(value, offset); else bad[offset] = value;
    bad.writeUInt32BE(crc(bad.subarray(12, 29)), 29);
    corruptions.push(bad);
  }
  for (const buffer of corruptions) {
    assert.throws(() => extractIco(ico([{ buffer, width: 2, height: 2 }])), /tinyico:/);
    assert.throws(() => encodeIco([{ buffer }]), /tinyico:/);
  }
});

test('PNG palettes and IDAT ordering are validated', () => {
  const valid = png(1, 1, undefined, { color: 3, depth: 1, palette: Buffer.from([1, 2, 3]), scanlines: Buffer.from([0, 0]) });
  const noPalette = png(1, 1, undefined, { color: 3, depth: 1, scanlines: Buffer.from([0, 0]) });
  const invalid = [noPalette,
    png(1, 1, undefined, { color: 3, depth: 1, palette: Buffer.alloc(9), scanlines: Buffer.from([0, 0]) }),
    png(1, 1, undefined, { color: 3, depth: 1, palette: Buffer.alloc(2), scanlines: Buffer.from([0, 0]) }),
    Buffer.concat([valid.subarray(0, -12), chunk('PLTE', Buffer.from([1, 2, 3])), chunk('IEND')]),
    png(1, 1, undefined, { before: [chunk('PLTE'), chunk('PLTE')] }),
    png(1, 1, undefined, { color: 0, scanlines: Buffer.from([0, 1]), palette: Buffer.from([1, 2, 3]) }),
  ];
  for (const buffer of invalid) assert.throws(() => encodeIco([{ buffer }]), /palette|ordering/);
  assert.ok(encodeIco([{ buffer: valid }]).length);
});

test('enforces input, aggregate pixel, output and PNG chunk-count limits', () => {
  const largeInput = Buffer.alloc(64 * 1024 * 1024 + 1);
  rejects(largeInput, /64 MiB/);
  const image = { rgba: Buffer.alloc(256 * 256 * 4), width: 256, height: 256 };
  assert.throws(() => encodeIco(new Array(65).fill(image), { format: 'dib' }), /pixel limit/);
  const entry = pngEntry(256);
  rejects(ico(new Array(65).fill(entry)), /pixel limit/);
  const small = pngEntry(1).buffer;
  const tooMany = Buffer.concat([small.subarray(0, 33), ...new Array(4096).fill(chunk('tEXt')), small.subarray(33)]);
  assert.throws(() => encodeIco([{ buffer: tooMany }]), /chunk count/);
  // Opaque ancillary chunks are retained, so many copies can exceed the container limit.
  const bigPng = png(1, 1, undefined, { before: [chunk('raNd', Buffer.alloc(1024 * 1024))] });
  assert.throws(() => encodeIco(new Array(64).fill({ buffer: bigPng })), /64 MiB/);
});

test('rejects wrong input types without treating other views as byte arrays', () => {
  for (const input of [null, undefined, [], {}, new ArrayBuffer(32), new DataView(new ArrayBuffer(32)), new Uint16Array(32)]) {
    assert.equal(isIco(input), false);
    assert.throws(() => parseIco(input), TypeError);
  }
});

test('deterministic mutation fuzzing never leaks unchecked range errors', () => {
  let state = 0x31415926;
  const next = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
  const corpus = [good, ico([dib(3, 2, 4)]), ico([dib(3, 2, 32)]), ico([pngEntry(2), pngEntry(4)])];
  for (let iteration = 0; iteration < 2000; iteration++) {
    const source = Buffer.from(corpus[iteration % corpus.length]);
    for (let i = 0, n = 1 + next() % 4; i < n; i++) source[next() % source.length] = next() & 255;
    for (const operation of [parseIco, extractIco, decodeIco]) {
      try { operation(source); } catch (error) {
        assert.equal(error.constructor, Error);
        assert.match(error.message, /^tinyico:/);
      }
    }
  }
});
