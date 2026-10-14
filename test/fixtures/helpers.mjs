// Independent binary fixture writers and PNG oracle. No imports from tinyico.
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';

export const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export function crc(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

export function chunk(type, data = Buffer.alloc(0)) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length);
  out.write(type, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc(out.subarray(4, -4)), out.length - 4);
  return out;
}

export function pattern(width, height, alpha = true) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgba[i] = (x * 53 + y * 17) % 256;
      rgba[i + 1] = (x * 19 + y * 97) % 256;
      rgba[i + 2] = (x * 113 + y * 7) % 256;
      rgba[i + 3] = alpha ? [0, 1, 64, 128, 254, 255][(x + y) % 6] : 255;
    }
  }
  return rgba;
}

export function png(width, height, rgba = pattern(width, height), options = {}) {
  const { depth = 8, color = 6, interlace = 0, palette, before = [], after = [] } = options;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth;
  ihdr[9] = color;
  ihdr[12] = interlace;
  // Other color types/interlacing supply their own pre-filtered serialized samples.
  const scanlines = options.scanlines ?? Buffer.concat(Array.from({ length: height }, (_, y) =>
    Buffer.concat([Buffer.from([0]), rgba.subarray(y * width * 4, (y + 1) * width * 4)])));
  return Buffer.concat([signature, chunk('IHDR', ihdr), ...before,
    ...(palette ? [chunk('PLTE', palette)] : []), chunk('IDAT', deflateSync(scanlines)), ...after, chunk('IEND')]);
}

export const palette = [
  [20, 40, 60], [230, 150, 70], [110, 90, 170], [30, 210, 190],
];

export function dib(width, height, depth, options = {}) {
  const { rgba = pattern(width, height), mask = (x, y) => (x + 2 * y) % 3 === 0,
    alpha = 'meaningful', omitMask = false, used = 0 } = options;
  const colors = depth <= 8 ? used || 2 ** depth : 0;
  const stride = Math.ceil(width * depth / 32) * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const start = 40 + colors * 4;
  const result = Buffer.alloc(start + stride * height + (omitMask ? 0 : maskStride * height));
  result.writeUInt32LE(40);
  result.writeInt32LE(width, 4);
  result.writeInt32LE(height * 2, 8);
  result.writeUInt16LE(1, 12);
  result.writeUInt16LE(depth, 14);
  result.writeUInt32LE(used, 32);
  for (let i = 0; i < colors; i++) {
    const [r, g, b] = palette[i % palette.length];
    result.set([b, g, r, 199], 40 + i * 4); // Reserved palette alpha is ignored.
  }
  const expected = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const row = start + (height - 1 - y) * stride;
      const i = (y * width + x) * 4;
      if (depth <= 8) {
        const index = (x + y) % Math.min(colors, 4);
        if (depth === 8) result[row + x] = index;
        else if (depth === 4) result[row + (x >> 1)] |= index << (x % 2 === 0 ? 4 : 0);
        else result[row + (x >> 3)] |= index << (7 - x % 8);
        expected.set(palette[index], i);
      } else {
        const j = row + x * depth / 8;
        result.set([rgba[i + 2], rgba[i + 1], rgba[i]], j);
        if (depth === 32) result[j + 3] = alpha === 'unused' ? 0 : rgba[i + 3];
        expected.set(rgba.subarray(i, i + 3), i);
      }
      if (!omitMask && mask(x, y)) result[start + stride * height + (height - 1 - y) * maskStride + (x >> 3)] |= 128 >> (x % 8);
      expected[i + 3] = depth === 32 && alpha === 'meaningful' ? rgba[i + 3] : mask(x, y) ? 0 : 255;
    }
  }
  return { buffer: result, expected, width, height, depth };
}

export function ico(images, type = 'ico') {
  const directory = Buffer.alloc(6 + images.length * 16);
  directory.writeUInt16LE(type === 'cur' ? 2 : 1, 2);
  directory.writeUInt16LE(images.length, 4);
  let offset = directory.length;
  images.forEach((image, i) => {
    const d = 6 + i * 16;
    directory[d] = image.width === 256 ? 0 : image.width;
    directory[d + 1] = image.height === 256 ? 0 : image.height;
    directory.writeUInt16LE(type === 'cur' ? image.hotspot?.x ?? 0 : 1, d + 4);
    directory.writeUInt16LE(type === 'cur' ? image.hotspot?.y ?? 0 : image.depth ?? 32, d + 6);
    directory.writeUInt32LE(image.buffer.length, d + 8);
    directory.writeUInt32LE(offset, d + 12);
    offset += image.buffer.length;
  });
  return Buffer.concat([directory, ...images.map(image => image.buffer)]);
}

export function pngEntry(width, height = width, options) {
  return { width, height, depth: 32, buffer: png(width, height, undefined, options) };
}

export function offsetView(buffer, offset = 13) {
  const storage = new Uint8Array(offset + buffer.length + 19).fill(0xa5);
  storage.set(buffer, offset);
  return storage.subarray(offset, offset + buffer.length);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Independently validates every CRC and unfilters RGBA8 output for pixel assertions. */
export function pixels(pngBuffer) {
  assert.deepEqual(pngBuffer.subarray(0, 8), signature);
  let width, height, ended = false;
  const compressed = [];
  for (let offset = 8; offset < pngBuffer.length;) {
    const size = pngBuffer.readUInt32BE(offset);
    const type = pngBuffer.toString('ascii', offset + 4, offset + 8);
    const data = pngBuffer.subarray(offset + 8, offset + 8 + size);
    assert.equal(crc(pngBuffer.subarray(offset + 4, offset + 8 + size)), pngBuffer.readUInt32BE(offset + 8 + size));
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.deepEqual([...data.subarray(8)], [8, 6, 0, 0, 0]);
    } else if (type === 'IDAT') compressed.push(data);
    else if (type === 'IEND') { ended = true; assert.equal(offset + 12, pngBuffer.length); }
    offset += 12 + size;
  }
  assert.ok(ended);
  const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: (width * 4 + 1) * height });
  const stride = width * 4;
  assert.equal(raw.length, (stride + 1) * height);
  const output = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const left = x >= 4 ? output[i - 4] : 0;
      const up = y > 0 ? output[i - stride] : 0;
      const diagonal = x >= 4 && y > 0 ? output[i - stride - 4] : 0;
      const add = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, diagonal)][filter];
      output[i] = (raw[y * (stride + 1) + x + 1] + add) & 255;
    }
  }
  return { width, height, rgba: output };
}
