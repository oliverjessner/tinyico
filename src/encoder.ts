import { Buffer } from 'node:buffer';
import { dibSize, writeDib } from './dib.js';
import { encodePng, validatePng } from './png.js';
import { bytes, dimension, fail, hotspot, MAX_BYTES, MAX_IMAGES, pixelBudget } from './validator.js';
import type { EncodeOptions, Hotspot, ImageInput } from './types.js';

interface Prepared {
  data: Buffer;
  width: number;
  height: number;
  bitDepth: number;
  size: number;
  dib: boolean;
  hotspot?: Hotspot;
}

export function encodeIco(images: readonly ImageInput[], options: EncodeOptions = {}): Buffer {
  if (!Array.isArray(images) || images.length < 1 || images.length > MAX_IMAGES) fail('expected between 1 and 256 images');
  const type = options.type ?? 'ico';
  const format = options.format ?? 'png';
  if (type !== 'ico' && type !== 'cur') fail('type must be ico or cur');
  if (format !== 'png' && format !== 'dib') fail('format must be png or dib');
  const prepared: Prepared[] = [];
  let total = 6 + images.length * 16;
  let pixels = 0;
  for (const image of images) {
    if (!image || typeof image !== 'object') fail('invalid image input');
    let item: Prepared;
    if (image.buffer !== undefined) {
      if (image.rgba !== undefined || image.width !== undefined || image.height !== undefined) fail('PNG and RGBA input fields are mutually exclusive');
      if (format === 'dib') fail('DIB output requires RGBA input; PNG pixel decoding is not supported');
      const data = bytes(image.buffer);
      const info = validatePng(data);
      item = { data, width: info.width, height: info.height, bitDepth: info.bitDepth, size: data.length, dib: false };
    } else {
      dimension(image.width, 'image width');
      dimension(image.height, 'image height');
      const data = bytes(image.rgba);
      if (data.length !== image.width * image.height * 4) fail('RGBA data length must equal width * height * 4');
      const dib = format === 'dib';
      // Check aggregate budgets before allocating compressed data.
      pixelBudget(pixels + image.width * image.height);
      const payload = dib ? data : encodePng(data, image.width, image.height);
      item = { data: payload, width: image.width, height: image.height, bitDepth: 32,
        size: dib ? dibSize(image.width, image.height) : payload.length, dib };
    }
    if (type === 'cur') item.hotspot = hotspot(image.hotspot, item.width, item.height);
    else if (image.hotspot !== undefined) fail('hotspots require type cur');
    pixels += item.width * item.height;
    pixelBudget(pixels);
    total += item.size;
    if (total > MAX_BYTES) fail('encoded file exceeds 64 MiB limit');
    prepared.push(item);
  }
  // One allocation for the container, including DIB payloads written in place.
  const output = Buffer.alloc(total);
  output.writeUInt16LE(type === 'ico' ? 1 : 2, 2);
  output.writeUInt16LE(prepared.length, 4);
  let offset = 6 + prepared.length * 16;
  for (let i = 0; i < prepared.length; i++) {
    const image = prepared[i]!;
    const dir = 6 + i * 16;
    output[dir] = image.width === 256 ? 0 : image.width;
    output[dir + 1] = image.height === 256 ? 0 : image.height;
    output.writeUInt16LE(image.hotspot ? image.hotspot.x : 1, dir + 4);
    output.writeUInt16LE(image.hotspot ? image.hotspot.y : image.bitDepth, dir + 6);
    output.writeUInt32LE(image.size, dir + 8);
    output.writeUInt32LE(offset, dir + 12);
    if (image.dib) writeDib(output, offset, image.data, image.width, image.height);
    else image.data.copy(output, offset);
    offset += image.size;
  }
  return output;
}
