# tinyico

![tinyico — ICO and CUR processing for Node.js, with zero dependencies](https://raw.githubusercontent.com/oliverjessner/tinyico/main/docs/assets/tinyico.svg)

**Zero dependencies. Minimal footprint. Fast ICO processing for Node.js.**

A small, synchronous ICO/CUR parser, extractor, decoder and encoder for **Node.js 26+**.

Native ESM, TypeScript declarations, no native addons, no bundler and **zero runtime
or optional dependencies**. TypeScript and Node.js types are development tools only.

PNG entries pass through without pixel decoding or recompression. Legacy Windows
DIB entries are converted to RGBA PNGs using only Node.js built-ins, including
`node:zlib` for compression and CRC32. tinyico focuses on icon containers rather
than general image processing.

## Installation

```sh
npm install tinyico
```

## Quick start

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { parseIco, isIco, extractIco, decodeIco, encodeIco } from 'tinyico';

const buffer = readFileSync('favicon.ico');
console.log(isIco(buffer));
console.log(parseIco(buffer));

writeFileSync('icon.png', extractIco(buffer, { size: 32 }));
for (const image of decodeIco(buffer)) {
    writeFileSync(`${image.index}-${image.width}x${image.height}.png`, image.buffer);
}

const ico = encodeIco([
    { buffer: readFileSync('16.png') },
    { buffer: readFileSync('32.png') },
    { buffer: readFileSync('256.png') },
]);
writeFileSync('output.ico', ico);
```

## API

![Extraction flow: inspect headers, select one entry, pass PNG bytes through or convert DIB pixels to PNG](https://raw.githubusercontent.com/oliverjessner/tinyico/main/docs/assets/data-flow.svg)

Every operation is synchronous. Binary inputs are `Buffer` or `Uint8Array`,
including views with a nonzero `byteOffset`. `ArrayBuffer`, `DataView`, other
typed arrays and browser APIs are not supported. Invalid data throws an `Error`
with a `tinyico:` prefix; wrong binary input types throw a `TypeError`.

### `parseIco(buffer): IcoMetadata`

Reads the ICO/CUR directory and embedded image headers, without decoding pixels
or inflating PNG data. Checks directory ranges, overlap, image dimensions,
DIB layout and PNG IHDR CRC. All entries are inspected, in directory order.
It does **not** walk PNG IDAT/ancillary chunks; use extraction/decoding for
the chunk validation described below.

```ts
interface IcoMetadata {
    readonly type: 'ico' | 'cur';
    readonly count: number;
    readonly images: readonly IcoEntry[];
}

interface IcoEntry {
    readonly index: number;
    readonly width: number;
    readonly height: number;
    readonly bitDepth: number;
    readonly format: 'png' | 'dib';
    readonly offset: number;
    readonly size: number;
    readonly hotspot?: { readonly x: number; readonly y: number };
}
```

`bitDepth` is bits per pixel from the embedded header, not a CUR hotspot or a
PNG directory hint. For PNG this is sample depth times channel count (indexed
PNG reports index depth). Dimension byte `0` means 256 independently on each
axis. Embedded and directory dimensions must agree. Zero ICO plane/depth hints
are accepted; nonzero DIB depth hints must agree. PNG depth hints are ignored.

### `isIco(buffer): boolean`

Nonthrowing, constant-size **header recognition** for ICO and CUR. Accepts
`unknown` and returns false for wrong types or fewer than six bytes. Checks the
reserved word, type and nonzero count. A recognized header can still belong to
a truncated, unsupported or otherwise invalid file. This is not a full validator.

### `extractIco(buffer, options?): Buffer`

Extracts one entry as a PNG buffer. With no selector, chooses index 0.

```js
const first = extractIco(buffer);
const second = extractIco(buffer, { index: 1 });
const square = extractIco(buffer, { size: 32 });
const rectangle = extractIco(buffer, { size: { width: 48, height: 24 } });
```

`index` is zero-based. `index` and `size` are mutually exclusive. Size selection
does not scale images. It ranks entries by these deterministic rules:

1. Prefer entries covering both requested dimensions over smaller entries.
2. Minimize `abs(width - requestedWidth) + abs(height - requestedHeight)`.
3. Prefer greater bits per pixel, then the earlier directory entry.

The directory and all embedded headers are validated first; only the selected
entry's PNG chunks or DIB pixels are processed. An unsupported header in another
entry still causes an error. An exact size match naturally has zero distance.

**An extracted PNG can share memory with the input**, including when returned
by `decodeIco`. Mutations are visible through both views, and keeping a small
view retains the entire backing allocation. Use `Buffer.from(result)` for an
independent copy. DIB conversion produces a new PNG allocation.

### `decodeIco(buffer): DecodedImage[]`

Returns all entries in directory order, each with the `IcoEntry` fields and a
`buffer: Buffer` containing PNG bytes. `format` describes the **original**
payload; the returned buffer is always PNG. Offsets/sizes also describe the input.
CUR hotspots are retained. No PNG entry is recompressed.

### `encodeIco(images, options?): Buffer`

Writes multiple entries into one ICO or CUR. The default is
`{ type: 'ico', format: 'png' }`. There is no automatic resizing.

An image is one of:

```ts
type ImageInput =
    | { buffer: Uint8Array; hotspot?: Hotspot }
    | { rgba: Uint8Array; width: number; height: number; hotspot?: Hotspot };
// Hotspot = { readonly x: number; readonly y: number }
// EncodeOptions = { readonly type?: 'ico' | 'cur'; readonly format?: 'png' | 'dib' }
```

PNG dimensions and bit depth come from IHDR. Compressed bytes are copied directly
into the final container after structural/CRC validation. RGBA input must be
top-down, tightly packed, unpremultiplied RGBA8 with exactly `width * height * 4`
bytes. Its PNG output uses filter None, one IDAT, and zlib's default compression.
No color metadata is added to raw RGBA.

```js
const rgba = Buffer.from([
    255,
    0,
    0,
    255, // opaque red
    0,
    0,
    255,
    128, // half-transparent blue
]);

const ico = encodeIco([{ rgba, width: 2, height: 1 }]);
const legacy = encodeIco([{ rgba, width: 2, height: 1 }], { format: 'dib' });
const cursor = encodeIco([{ rgba, width: 2, height: 1, hotspot: { x: 1, y: 0 } }], { type: 'cur', format: 'dib' });
```

`format: 'dib'` writes 32-bit BI_RGB pixels and an AND mask directly into the final
container. It requires RGBA inputs; requesting PNG-to-DIB conversion throws
because the library does not include a PNG pixel decoder. PNG and RGBA inputs
can be mixed with the default PNG output.

CUR requires an explicit hotspot for **every** image, with integer coordinates
`0 <= x < width` and `0 <= y < height`. ICO inputs with hotspots are rejected.
The output owns its memory and does not share buffers with the inputs.

All public input, option and result types are exported from `tinyico`.

## Supported formats

| Input            | Support                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| ICO and CUR      | Multiple entries, rectangular images, 1–256 pixels per axis                                             |
| Embedded PNG     | All standard color types, valid sample depths, interlaced or noninterlaced; byte-preserving passthrough |
| Windows DIB      | 40-byte BITMAPINFOHEADER, BI_RGB, bottom-up, 1/4/8/24/32 bits per pixel                                 |
| Indexed DIB      | BGR palettes, `biClrUsed`, packed indices, DWORD row padding                                            |
| DIB transparency | 1-bit AND masks and unpremultiplied 32-bit alpha                                                        |

For 32-bit BI_RGB, **any nonzero alpha sample makes the alpha channel
authoritative**, so AND bits are ignored. If every alpha byte is zero, the high
bytes are treated as legacy reserved data and transparency comes from the AND
mask. A 32-bit DIB may omit its mask only when it has meaningful alpha. Lower
depths require a complete AND mask. Palette reserved bytes are not alpha.
The encoder writes AND bits for alpha-zero pixels, preserving fully transparent
RGBA images even through the legacy fallback. RGB values under zero alpha are
preserved. Monochrome screen-inversion effects cannot be represented in RGBA;
AND bits are mapped to transparent pixels.

## Validation, limits and limitations

Inputs are treated as untrusted. Fixed limits bound work and allocations:

| Limit                                  |                                      Value |
| -------------------------------------- | -----------------------------------------: |
| Input or encoded ICO/CUR bytes         |                                     64 MiB |
| Entries per container                  |                                        256 |
| Width and height per image             |                                 1–256 each |
| Sum of all entry areas                 | 4,194,304 pixels (16 MiB equivalent RGBA8) |
| PNG chunks per extracted/encoded entry |                                      4,096 |

These limits are fixed rather than caller-configurable. DIB strides, palette
sizes, image sizes and AND-mask lengths are checked before pixel allocation.
Entry payloads cannot overlap each other or the directory; even identical
shared ranges are rejected. Out-of-order payloads and gaps are allowed. Offset
and length checks use subtraction against the actual view length. DIB trailing
bytes, inconsistent dimensions and truncated regions are rejected.

PNG extraction and encoding validate signatures, IHDR fields, chunk types,
bounds, ordering of critical chunks, palette sizes, all chunk CRCs, and a final
IEND with no trailing bytes. Unknown critical chunks are rejected. Ancillary
chunks, including color profiles and animation extensions, are opaque and
preserved. **IDAT is never inflated for passthrough**, so compressed-stream
validity, pixel indices, ancillary semantics and animation frames are not
validated. A structurally valid PNG is not necessarily a decodable PNG. tinyico
is not a general PNG validator or image sanitizer; the limits do not constrain
what an external decoder may allocate for opaque ancillary data.

Unsupported DIB variants throw explicitly: BI_BITFIELDS and other compression,
16-bit pixels, top-down layouts, OS/2 headers, V2/V3/V4/V5 headers, nonindexed
color tables and standalone BMP files. There is no generic PNG decoding,
JPEG/SVG, scaling, optimization, CLI, network access, Canvas or browser support.
All APIs block the calling thread; use worker threads when processing large
batches in a latency-sensitive server.

## Performance and footprint

Metadata uses views and fixed-size header reads. PNG extraction uses
`Buffer.subarray()` and native CRC32; encoding precomputes offsets and allocates
one final container. DIB output is written in place. Raw RGBA-to-PNG and DIB-to-PNG
require scanline/compression buffers. No claim of zero allocations is made.

The published artifact contains only the eight compiled ESM modules, their
declarations, README, LICENSE and package metadata. Tests, fixtures, benchmarks,
sources and development dependencies are excluded. Measured sizes and local
benchmark results are recorded in [BENCHMARKS.md](https://github.com/oliverjessner/tinyico/blob/main/BENCHMARKS.md).

```sh
npm run build
npm pack --dry-run
node --input-type=module -e "import {readdirSync,statSync} from 'node:fs'; console.log(readdirSync('dist').reduce((n,f)=>n+statSync('dist/'+f).size,0),'dist bytes')"
npm ls --omit=dev --all
```

## Tests

```sh
npm ci
npm run typecheck
npm test
# Optional coverage:
node --test --experimental-test-coverage test/*.test.mjs
```

Tests use only `node:test`, `node:assert/strict` and other built-ins. Fixtures
and the CRC/pixel oracle are independent of production code. Roundtrips compare
all RGB and alpha values. Tests cover each DIB depth, padding, orientation,
palettes, alpha fallback, PNG passthrough, CUR, 256-pixel dimensions, byte offsets,
selection, malformed/truncated inputs, resource limits and deterministic
mutation fuzzing. Fixed binary fixtures can be regenerated with
`node test/fixtures/generate.mjs`.

## Benchmarks against icojs

![Measured processing time for PNG extraction, DIB conversion, ICO creation and batches; independent zero-based scales per panel](https://raw.githubusercontent.com/oliverjessner/tinyico/main/docs/assets/benchmark-time.svg)

Local synthetic fixtures on Apple M2 Pro and Node.js 26.11.1, measured
2026-10-14. Bars show medians; whiskers show the observed sample min–max,
not confidence intervals. tinyico uses synchronous calls; icojs is awaited.
Validation and compression work differ. See the
[full results and memory chart](https://github.com/oliverjessner/tinyico/blob/main/BENCHMARKS.md).

```sh
npm run bench
# Optional comparator, outside this project's dependency tree:
npm install --prefix /tmp/tinyico-icojs-bench --no-audit --no-fund --save-exact icojs@1.0.1
TINYICO_ICOJS_ROOT=/tmp/tinyico-icojs-bench npm run bench -- --json=/tmp/tinyico-results.json
# Longer run, using the same inputs:
TINYICO_BENCH_ITERATIONS=2000 TINYICO_ICOJS_ROOT=/tmp/tinyico-icojs-bench npm run bench
```

There is no automatic comparator download. Without icojs, tinyico cases still
run and the missing comparator is reported. The comparator never becomes a
tinyico dependency. Pin its version for reproducibility.

Cases include metadata, single-entry PNG extraction, 32-bit legacy DIB-to-PNG,
ICO creation from 16/32/256 PNGs, and batches of 100 icons. They use identical
binary files. icojs has no public metadata-only equivalent, so that comparison
is marked unavailable. Encoding explicitly requests PNG entries in icojs.
Single-entry files avoid comparing lazy extraction with multi-image decoding.
Representative output bytes/pixels are verified before timing.

The runner uses `node:perf_hooks`, warmup and five timed samples, reports median
elapsed time, microseconds/operation and operations/second, and records fixture
hashes and environment details. Each library/case runs in a fresh child process.
Synchronous loops are not artificially awaited; icojs calls are awaited
sequentially. Sync no-op and async await baselines are reported separately and
not subtracted. Both libraries include validation, API and compression work;
differences must not be attributed solely to promises.

A separate memory phase retains 16 operation results and reports RSS, heap,
external and ArrayBuffer bytes before retention, during retention and after
release/GC. Process peak RSS includes startup and timing, not just the memory
phase. `arrayBuffers` is included in `external`; do not add them. Small deltas
can be noisy. Batch operations process 100 icons, so their operations/second
must be multiplied by 100 to get icons/second. Results depend on corpus, machine,
GC, compression strategy and Node.js version; no universal speed advantage is
claimed.

## Development layout

```text
src/
  index.ts       public exports
  parser.ts      ICO/CUR directory and metadata
  encoder.ts     ICO/CUR creation
  decoder.ts     selection and PNG extraction
  dib.ts         BI_RGB layout, pixels and in-place writing
  png.ts         PNG structure, CRC and RGBA encoding
  validator.ts   binary views, bounds and resource limits
  types.ts       public TypeScript contracts
test/
  fixtures/      reproducible binary files and independent helpers
  parser.test.mjs
  decoder.test.mjs
  encoder.test.mjs
  security.test.mjs
bench/
  benchmark.mjs
  render-graphics.mjs  SVG documentation assets from saved measurements
  results.json   measured local run
docs/
  assets/        project header, extraction flow and benchmark SVGs
```

Regenerate documentation graphics with `npm run docs:graphics`. It reads the
saved comparison in `bench/results.json` without rerunning benchmarks. The SVGs
contain no scripts, remote fonts or linked assets and are excluded from the npm
package. README image URLs target the repository so npm can display the same
graphics once the files have been pushed to GitHub.

## License

[MIT](./LICENSE) © 2026 Oliver Jessner.
