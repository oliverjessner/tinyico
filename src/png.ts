import { Buffer } from 'node:buffer';
import { crc32, deflateSync } from 'node:zlib';
import { dimension, fail, range } from './validator.js';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export interface PngInfo {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  sampleDepth: number;
}

export function isPng(data: Buffer): boolean {
  return data.length >= 8 && data.subarray(0, 8).equals(SIGNATURE);
}

/** Header-only work for metadata parsing; no IDAT traversal or inflation. */
export function readPng(data: Buffer): PngInfo {
  range(0, 33, data.length, 'PNG IHDR');
  if (!isPng(data) || data.readUInt32BE(8) !== 13 || data.readUInt32BE(12) !== 0x49484452) {
    fail('invalid PNG signature or IHDR');
  }
  if (crc32(data.subarray(12, 29)) !== data.readUInt32BE(29)) fail('PNG IHDR CRC mismatch');
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  dimension(width, 'PNG width');
  dimension(height, 'PNG height');
  const sampleDepth = data[24]!;
  const colorType = data[25]!;
  const channels = CHANNELS[colorType];
  const validDepth = colorType === 0 ? [1, 2, 4, 8, 16].includes(sampleDepth)
    : colorType === 3 ? [1, 2, 4, 8].includes(sampleDepth)
    : sampleDepth === 8 || sampleDepth === 16;
  if (!channels || !validDepth || data[26] !== 0 || data[27] !== 0 || data[28]! > 1) {
    fail('invalid PNG color type, bit depth, compression, filter or interlace method');
  }
  return { width, height, bitDepth: channels * sampleDepth, colorType, sampleDepth };
}

/** Validate framing and CRCs without interpreting ancillary chunks or inflating pixels. */
export function validatePng(data: Buffer, info = readPng(data)): PngInfo {
  let offset = 33;
  let palette = false;
  let idat = false;
  let endedIdat = false;
  let compressedBytes = 0;
  let chunks = 1;
  while (offset < data.length) {
    if (++chunks > 4096) fail('PNG chunk count exceeds 4096 limit');
    range(offset, 12, data.length, 'PNG chunk');
    const size = data.readUInt32BE(offset);
    if (size > 0x7fffffff) fail('PNG chunk exceeds specification limit');
    range(offset + 12, size, data.length, 'PNG chunk data');
    for (let i = offset + 4; i < offset + 8; i++) {
      const c = data[i]!;
      if (!(c >= 65 && c <= 90) && !(c >= 97 && c <= 122)) fail('invalid PNG chunk type');
    }
    if ((data[offset + 6]! & 32) !== 0) fail('invalid PNG reserved chunk bit');
    const type = data.toString('ascii', offset + 4, offset + 8);
    if (crc32(data.subarray(offset + 4, offset + 8 + size)) !== data.readUInt32BE(offset + 8 + size)) {
      fail(`PNG ${type} CRC mismatch`);
    }
    if (type === 'IHDR') fail('duplicate PNG IHDR');
    if (type === 'PLTE') {
      if (palette || idat || info.colorType === 0 || info.colorType === 4 ||
          size === 0 || size % 3 !== 0 || size > 768 ||
          (info.colorType === 3 && size / 3 > 2 ** info.sampleDepth)) fail('invalid PNG palette');
      palette = true;
    } else if (type === 'IDAT') {
      if (endedIdat || (info.colorType === 3 && !palette)) fail('invalid PNG IDAT ordering or missing palette');
      idat = true;
      compressedBytes += size;
    } else if (type === 'IEND') {
      if (size !== 0 || !idat || compressedBytes === 0 || offset + 12 !== data.length) {
        fail('invalid PNG IEND or missing image data');
      }
      return info;
    } else if ((data[offset + 4]! & 32) === 0) {
      fail(`unsupported critical PNG chunk ${type}`);
    }
    if (idat && type !== 'IDAT') endedIdat = true;
    offset += 12 + size;
  }
  return fail('missing PNG IEND');
}

function chunk(target: Buffer, offset: number, type: string, data: Buffer): number {
  target.writeUInt32BE(data.length, offset);
  target.write(type, offset + 4, 4, 'ascii');
  data.copy(target, offset + 8);
  target.writeUInt32BE(crc32(target.subarray(offset + 4, offset + 8 + data.length)), offset + 8 + data.length);
  return offset + 12 + data.length;
}

export function encodePng(rgba: Buffer, width: number, height: number): Buffer {
  const row = width * 4;
  const scanlines = Buffer.allocUnsafe((row + 1) * height);
  for (let y = 0; y < height; y++) {
    scanlines[y * (row + 1)] = 0; // PNG filter None
    rgba.copy(scanlines, y * (row + 1) + 1, y * row, (y + 1) * row);
  }
  const compressed = deflateSync(scanlines);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const output = Buffer.allocUnsafe(57 + compressed.length);
  SIGNATURE.copy(output);
  let offset = chunk(output, 8, 'IHDR', header);
  offset = chunk(output, offset, 'IDAT', compressed);
  chunk(output, offset, 'IEND', Buffer.alloc(0));
  return output;
}
