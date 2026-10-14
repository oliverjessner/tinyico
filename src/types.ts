import type { Buffer } from 'node:buffer';

export type BinaryInput = Uint8Array;
export type IconType = 'ico' | 'cur';
export type ImageFormat = 'png' | 'dib';

export interface Hotspot {
  readonly x: number;
  readonly y: number;
}

export interface IcoEntry {
  readonly index: number;
  readonly width: number;
  readonly height: number;
  /** Bits per pixel of the embedded image, independent of directory hints. */
  readonly bitDepth: number;
  readonly format: ImageFormat;
  readonly offset: number;
  readonly size: number;
  readonly hotspot?: Hotspot;
}

export interface IcoMetadata {
  readonly type: IconType;
  readonly count: number;
  readonly images: readonly IcoEntry[];
}

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/** Omit both selectors to choose index 0. Selectors are mutually exclusive. */
export interface ExtractOptions {
  readonly index?: number;
  readonly size?: number | ImageSize;
}

export interface DecodedImage extends IcoEntry {
  /** PNG bytes; a passthrough buffer may share memory with the input. */
  readonly buffer: Buffer;
}

export interface PngImageInput {
  readonly buffer: BinaryInput;
  readonly rgba?: never;
  readonly width?: never;
  readonly height?: never;
  readonly hotspot?: Hotspot;
}

export interface RgbaImageInput {
  /** Unpremultiplied RGBA8, top-down, tightly packed, exactly width*height*4 bytes. */
  readonly rgba: BinaryInput;
  readonly width: number;
  readonly height: number;
  readonly buffer?: never;
  readonly hotspot?: Hotspot;
}

export type ImageInput = PngImageInput | RgbaImageInput;

export interface EncodeOptions {
  /** Defaults to ico. Each cur image requires a hotspot within its dimensions. */
  readonly type?: IconType;
  /** Defaults to png. dib requires RGBA input; PNG pixel decoding is not provided. */
  readonly format?: ImageFormat;
}
