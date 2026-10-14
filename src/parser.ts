import { isUint8Array } from 'node:util/types';
import { readDib } from './dib.js';
import { isPng, readPng } from './png.js';
import { bytes, fail, hotspot, MAX_IMAGES, pixelBudget, range } from './validator.js';
import type { BinaryInput, IcoEntry, IcoMetadata } from './types.js';

/** Header recognition only, not a validity or security check. Recognizes ICO and CUR. */
export function isIco(input: unknown): input is BinaryInput {
  return isUint8Array(input) && input.length >= 6 && input[0] === 0 && input[1] === 0 &&
    (input[2] === 1 || input[2] === 2) && input[3] === 0 && (input[4] !== 0 || input[5] !== 0);
}

export function parseIco(input: BinaryInput): IcoMetadata {
  const data = bytes(input);
  range(0, 6, data.length, 'ICO/CUR header');
  if (!isIco(data)) fail('invalid ICO/CUR header');
  const count = data.readUInt16LE(4);
  if (count > MAX_IMAGES) fail('image count exceeds 256 limit');
  const directoryEnd = 6 + count * 16;
  range(6, count * 16, data.length, 'ICO/CUR directory');
  const type = data[2] === 1 ? 'ico' : 'cur';
  const images: IcoEntry[] = [];
  let pixels = 0;
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    const width = data[entry] || 256;
    const height = data[entry + 1] || 256;
    if (data[entry + 3] !== 0) fail('invalid directory reserved byte');
    const size = data.readUInt32LE(entry + 8);
    const offset = data.readUInt32LE(entry + 12);
    if (offset < directoryEnd || size === 0) fail('image data overlaps directory or is empty');
    range(offset, size, data.length, 'image data range');
    images.push({ index: i, width, height, bitDepth: 0, format: 'dib', offset, size });
  }
  // Validate all ranges before reading image headers. Never reorder directory entries.
  const sorted = images.slice().sort((a, b) => a.offset - b.offset);
  for (let i = 1; i < count; i++) {
    if (sorted[i]!.offset < sorted[i - 1]!.offset + sorted[i - 1]!.size) fail('overlapping image data ranges');
  }
  for (let i = 0; i < count; i++) {
    const entry = images[i]!;
    const payload = data.subarray(entry.offset, entry.offset + entry.size);
    const png = isPng(payload);
    const info = png ? readPng(payload) : readDib(payload);
    if (info.width !== entry.width || info.height !== entry.height) fail('directory dimensions disagree with image header');
    const dir = 6 + i * 16;
    if (type === 'ico') {
      const planes = data.readUInt16LE(dir + 4);
      const depth = data.readUInt16LE(dir + 6);
      if (planes > 1 || (!png && depth !== 0 && depth !== info.bitDepth)) fail('directory planes or bit depth disagree with image header');
    }
    const base = { ...entry, bitDepth: info.bitDepth, format: png ? 'png' as const : 'dib' as const };
    images[i] = type === 'cur'
      ? { ...base, hotspot: hotspot({ x: data.readUInt16LE(dir + 4), y: data.readUInt16LE(dir + 6) }, entry.width, entry.height) }
      : base;
    pixels += entry.width * entry.height;
    pixelBudget(pixels);
  }
  return { type, count, images };
}
