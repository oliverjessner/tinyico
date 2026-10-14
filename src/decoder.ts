import type { Buffer } from 'node:buffer';
import { decodeDib } from './dib.js';
import { parseIco } from './parser.js';
import { encodePng, validatePng } from './png.js';
import { bytes, dimension, fail } from './validator.js';
import type { BinaryInput, DecodedImage, ExtractOptions, IcoEntry } from './types.js';

function extract(data: Buffer, entry: IcoEntry): Buffer {
  const payload = data.subarray(entry.offset, entry.offset + entry.size);
  if (entry.format === 'png') {
    validatePng(payload);
    return payload;
  }
  return encodePng(decodeDib(payload), entry.width, entry.height);
}

function select(images: readonly IcoEntry[], options: ExtractOptions): IcoEntry {
  if (options.index !== undefined && options.size !== undefined) fail('index and size are mutually exclusive');
  if (options.size === undefined) {
    const index = options.index ?? 0;
    if (!Number.isInteger(index) || index < 0 || index >= images.length) fail('image index out of range');
    return images[index]!;
  }
  const size = options.size;
  const width = typeof size === 'number' ? size : size?.width;
  const height = typeof size === 'number' ? size : size?.height;
  dimension(width, 'requested width');
  dimension(height, 'requested height');
  // Prefer images that cover both dimensions, then distance, depth, directory order.
  let best = images[0]!;
  const score = (image: IcoEntry): number => Math.abs(image.width - width) + Math.abs(image.height - height);
  for (let i = 1; i < images.length; i++) {
    const image = images[i]!;
    const covers = image.width >= width && image.height >= height;
    const bestCovers = best.width >= width && best.height >= height;
    if ((covers && !bestCovers) || (covers === bestCovers &&
        (score(image) < score(best) || (score(image) === score(best) && image.bitDepth > best.bitDepth)))) best = image;
  }
  return best;
}

export function extractIco(input: BinaryInput, options: ExtractOptions = {}): Buffer {
  const data = bytes(input);
  return extract(data, select(parseIco(data).images, options));
}

export function decodeIco(input: BinaryInput): DecodedImage[] {
  const data = bytes(input);
  return parseIco(data).images.map(entry => ({ ...entry, buffer: extract(data, entry) }));
}
