import { Buffer } from 'node:buffer';
import { dimension, fail, range } from './validator.js';

export interface DibInfo {
  width: number;
  height: number;
  bitDepth: number;
  paletteSize: number;
  pixelsOffset: number;
  stride: number;
  maskStride: number;
  maskOffset: number;
  hasMask: boolean;
}

/** ICO DIBs have no BMP file header and store XOR+AND height in biHeight. */
export function readDib(data: Buffer): DibInfo {
  range(0, 40, data.length, 'DIB header');
  if (data.readUInt32LE(0) !== 40) fail('unsupported DIB header (only 40-byte BITMAPINFOHEADER is supported)');
  const width = data.readInt32LE(4);
  const doubledHeight = data.readInt32LE(8);
  dimension(width, 'DIB width');
  if (doubledHeight <= 0 || doubledHeight % 2 !== 0) fail('invalid DIB height (expected positive doubled height)');
  const height = doubledHeight / 2;
  dimension(height, 'DIB height');
  if (data.readUInt16LE(12) !== 1) fail('invalid DIB planes');
  const bitDepth = data.readUInt16LE(14);
  if (![1, 4, 8, 24, 32].includes(bitDepth)) fail(`unsupported DIB bit depth ${bitDepth}`);
  if (data.readUInt32LE(16) !== 0) fail('unsupported DIB compression (only BI_RGB is supported)');
  const used = data.readUInt32LE(32);
  if ((bitDepth <= 8 && used > 2 ** bitDepth) || (bitDepth > 8 && used !== 0)) fail('unsupported or invalid DIB palette size');
  const paletteSize = bitDepth <= 8 ? used || 2 ** bitDepth : 0;
  const pixelsOffset = 40 + paletteSize * 4;
  const stride = Math.ceil(width * bitDepth / 32) * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const maskOffset = pixelsOffset + stride * height;
  range(40, paletteSize * 4, data.length, 'DIB palette');
  range(pixelsOffset, stride * height, data.length, 'DIB pixels');
  const hasMask = data.length !== maskOffset;
  if (!hasMask && bitDepth !== 32) fail('missing DIB AND mask');
  if (hasMask) {
    range(maskOffset, maskStride * height, data.length, 'DIB AND mask');
    if (data.length !== maskOffset + maskStride * height) fail('unexpected trailing DIB data');
  }
  const imageSize = data.readUInt32LE(20);
  if (imageSize !== 0 && imageSize !== stride * height &&
      imageSize !== stride * height + (hasMask ? maskStride * height : 0)) fail('invalid DIB image size');
  return { width, height, bitDepth, paletteSize, pixelsOffset, stride, maskStride, maskOffset, hasMask };
}

export function decodeDib(data: Buffer): Buffer {
  const info = readDib(data);
  const { width, height, bitDepth, paletteSize, pixelsOffset, stride, maskStride, maskOffset, hasMask } = info;
  let useAlpha = false;
  if (bitDepth === 32) {
    // All-zero high bytes are reserved/unused in older BI_RGB icons.
    outer: for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[pixelsOffset + y * stride + x * 4 + 3] !== 0) {
          useAlpha = true;
          break outer;
        }
      }
    }
    if (!useAlpha && !hasMask) fail('32-bit DIB without alpha requires an AND mask');
  }
  const output = Buffer.allocUnsafe(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = pixelsOffset + (height - 1 - y) * stride;
    const mask = maskOffset + (height - 1 - y) * maskStride;
    for (let x = 0; x < width; x++) {
      const dest = (y * width + x) * 4;
      let source: number;
      if (bitDepth <= 8) {
        const value = data[row + Math.floor(x * bitDepth / 8)]!;
        const index = bitDepth === 8 ? value : bitDepth === 4
          ? (value >>> (x % 2 === 0 ? 4 : 0)) & 15
          : (value >>> (7 - x % 8)) & 1;
        if (index >= paletteSize) fail('DIB pixel references missing palette entry');
        source = 40 + index * 4;
      } else {
        source = row + x * (bitDepth / 8);
      }
      output[dest] = data[source + 2]!;
      output[dest + 1] = data[source + 1]!;
      output[dest + 2] = data[source]!;
      // Meaningful 32-bit alpha is authoritative; legacy alpha falls back to AND.
      output[dest + 3] = useAlpha ? data[source + 3]!
        : hasMask && (data[mask + (x >>> 3)]! & (128 >>> (x & 7))) !== 0 ? 0 : 255;
    }
  }
  return output;
}

export function dibSize(width: number, height: number): number {
  return 40 + (width * 4 + Math.ceil(width / 32) * 4) * height;
}

/** Write directly into the final ICO allocation. Padding and reserved fields must be zero. */
export function writeDib(target: Buffer, offset: number, rgba: Buffer, width: number, height: number): void {
  target.writeUInt32LE(40, offset);
  target.writeInt32LE(width, offset + 4);
  target.writeInt32LE(height * 2, offset + 8);
  target.writeUInt16LE(1, offset + 12);
  target.writeUInt16LE(32, offset + 14);
  const stride = width * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  target.writeUInt32LE((stride + maskStride) * height, offset + 20);
  const maskOffset = offset + 40 + stride * height;
  for (let y = 0; y < height; y++) {
    const row = offset + 40 + (height - 1 - y) * stride;
    const mask = maskOffset + (height - 1 - y) * maskStride;
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4;
      const dest = row + x * 4;
      target[dest] = rgba[source + 2]!;
      target[dest + 1] = rgba[source + 1]!;
      target[dest + 2] = rgba[source]!;
      target[dest + 3] = rgba[source + 3]!;
      if (rgba[source + 3] === 0) target[mask + (x >>> 3)]! |= 128 >>> (x & 7);
    }
  }
}
