import { Buffer } from 'node:buffer';
import { isUint8Array } from 'node:util/types';
import type { Hotspot } from './types.js';

export const MAX_BYTES = 64 * 1024 * 1024;
export const MAX_IMAGES = 256;
export const MAX_PIXELS = 4 * 1024 * 1024;

export function fail(message: string): never {
  throw new Error(`tinyico: ${message}`);
}

export function bytes(input: unknown): Buffer {
  if (!isUint8Array(input)) throw new TypeError('tinyico: expected Buffer or Uint8Array');
  if (input.byteLength > MAX_BYTES) fail('input exceeds 64 MiB limit');
  return Buffer.isBuffer(input)
    ? input
    : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
}

export function range(offset: number, length: number, total: number, label: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) ||
      offset < 0 || length < 0 || offset > total || length > total - offset) {
    fail(`invalid or truncated ${label}`);
  }
}

export function dimension(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 256) {
    fail(`${label} must be an integer between 1 and 256`);
  }
}

export function pixelBudget(total: number): void {
  if (total > MAX_PIXELS) fail('total image area exceeds 4194304 pixel limit');
}

export function hotspot(value: Hotspot | undefined, width: number, height: number): Hotspot {
  if (!value || !Number.isInteger(value.x) || !Number.isInteger(value.y) ||
      value.x < 0 || value.y < 0 || value.x >= width || value.y >= height) {
    fail('CUR hotspot must contain integer x/y coordinates inside the image');
  }
  return { x: value.x, y: value.y };
}
