// Run from any directory: node test/fixtures/generate.mjs
import { writeFileSync } from 'node:fs';
import { dib, ico, pngEntry } from './helpers.mjs';

writeFileSync(new URL('mixed.ico', import.meta.url), ico([pngEntry(16), dib(7, 3, 4), pngEntry(256)]));
writeFileSync(new URL('cursor.cur', import.meta.url), ico([
  { ...pngEntry(8), hotspot: { x: 2, y: 3 } },
  { ...dib(5, 3, 24), hotspot: { x: 0, y: 0 } },
], 'cur'));
writeFileSync(new URL('legacy.ico', import.meta.url), ico([dib(32, 32, 32)]));
writeFileSync(new URL('png.ico', import.meta.url), ico([pngEntry(32)]));
