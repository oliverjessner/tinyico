import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as tinyico from '../dist/index.js';
import { png, pixels, pattern } from '../test/fixtures/helpers.mjs';

// Every library/case gets a fresh process. Imports and fixture preparation are untimed.
const cases = ['metadata', 'png-extract', 'dib-to-png', 'encode', 'batch', 'overhead'];
const base = Number(process.env.TINYICO_BENCH_ITERATIONS ?? 500);
if (!Number.isInteger(base) || base < 10 || base > 1_000_000) throw new Error('TINYICO_BENCH_ITERATIONS must be 10..1000000');
const samples = 5;
const fixtures = Object.fromEntries(['mixed.ico', 'png.ico', 'legacy.ico'].map(name =>
  [name, readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url))]));

async function loadIcojs() {
  if (process.env.TINYICO_ICOJS_ROOT) {
    const require = createRequire(resolve(process.env.TINYICO_ICOJS_ROOT, 'package.json'));
    return import(pathToFileURL(require.resolve('icojs')).href);
  }
  try { return await import('icojs'); } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes("package 'icojs'")) return null;
    throw error;
  }
}

function memory() {
  const { rss, heapUsed, external, arrayBuffers } = process.memoryUsage();
  return { rss, heapUsed, external, arrayBuffers };
}

async function collect() {
  // Buffer backing-store accounting may settle one GC later than heap accounting.
  globalThis.gc?.();
  await new Promise(resolveImmediate => setImmediate(resolveImmediate));
  globalThis.gc?.();
  globalThis.gc?.();
}

function syncLoop(fn, count) {
  const start = performance.now();
  for (let i = 0; i < count; i++) fn();
  return performance.now() - start;
}

async function asyncLoop(fn, count) {
  const start = performance.now();
  for (let i = 0; i < count; i++) await fn();
  return performance.now() - start;
}

async function worker(caseName, library) {
  const asynchronous = library === 'icojs';
  const api = asynchronous ? await loadIcojs() : tinyico;
  if (!api) throw new Error('icojs was requested but is unavailable');
  const pngFile = fixtures['png.ico'];
  const dibFile = fixtures['legacy.ico'];
  const buffers = [16, 32, 256].map(size => png(size, size));
  const encodeInput = buffers.map(buffer => ({ buffer, usePngIcon: true }));
  const batch = Array.from({ length: 100 }, (_, i) => i % 2 === 0 ? pngFile : dibFile);
  const count = caseName === 'batch' ? Math.max(1, Math.floor(base / 100)) : base;
  let fn;
  if (caseName === 'metadata') fn = () => api.parseIco(fixtures['mixed.ico']);
  if (caseName === 'png-extract') fn = asynchronous
    ? async () => (await api.decodeIco(pngFile, 'image/png'))[0].buffer
    : () => api.extractIco(pngFile);
  if (caseName === 'dib-to-png') fn = asynchronous
    ? async () => (await api.decodeIco(dibFile, 'image/png'))[0].buffer
    : () => api.extractIco(dibFile);
  if (caseName === 'encode') fn = () => api.encodeIco(encodeInput);
  if (caseName === 'batch') fn = asynchronous
    ? async () => { const out = []; for (const data of batch) out.push(await api.decodeIco(data, 'image/png')); return out; }
    : () => batch.map(data => api.decodeIco(data));
  if (caseName === 'overhead') fn = asynchronous ? async () => 1 : () => 1;
  if (!fn) throw new Error('Unknown benchmark case');

  // Validate representative results before measuring. Pixel checks include alpha.
  if (caseName === 'png-extract') assert.deepEqual(Buffer.from(await fn()), tinyico.extractIco(pngFile));
  if (caseName === 'dib-to-png') assert.deepEqual(pixels(Buffer.from(await fn())), pixels(tinyico.extractIco(dibFile)));
  if (caseName === 'encode') {
    const output = tinyico.decodeIco(Buffer.from(await fn()));
    assert.equal(output.length, 3);
    output.forEach((image, i) => {
      assert.deepEqual(image.buffer, buffers[i]);
      assert.deepEqual(pixels(image.buffer).rgba, pattern(image.width, image.height));
    });
  }
  const loop = asynchronous ? asyncLoop : syncLoop;
  await loop(fn, Math.min(count, 30));
  const elapsed = [];
  for (let i = 0; i < samples; i++) {
    globalThis.gc?.();
    elapsed.push(await loop(fn, count));
  }

  // Separate untimed retention experiment: keep 16 complete operation results alive.
  await collect();
  const before = memory();
  let held = [];
  for (let i = 0; i < 16; i++) held.push(asynchronous ? await fn() : fn());
  // Keep results explicitly reachable even if V8 shortens local-variable liveness.
  globalThis.tinyicoBenchmarkResults = held;
  await collect();
  const retained = memory();
  globalThis.tinyicoBenchmarkResults = undefined;
  held = undefined;
  await collect();
  const afterRelease = memory();
  const sorted = elapsed.slice().sort((a, b) => a - b);
  const medianMs = sorted[Math.floor(sorted.length / 2)];
  return {
    case: caseName, library, mode: asynchronous ? 'async (await/operation)' : 'sync',
    iterations: count, samples, elapsedMs: elapsed, medianMs,
    microsecondsPerOperation: medianMs * 1000 / count,
    operationsPerSecond: count * 1000 / medianMs,
    ...(caseName === 'batch' ? { iconsPerOperation: 100, iconsPerSecond: count * 1000 * 100 / medianMs } : {}),
    memory: { gcAvailable: Boolean(globalThis.gc), retainedOperations: 16, before, retained, afterRelease,
      processPeakRss: process.resourceUsage().maxRSS * 1024 },
  };
}

if (process.argv[2] === '--worker') {
  try { process.send(await worker(process.argv[3], process.argv[4])); }
  catch (error) { console.error(error); process.exitCode = 1; }
  process.disconnect();
} else {
  const comparator = await loadIcojs();
  let icojsVersion = null;
  if (comparator) {
    const require = process.env.TINYICO_ICOJS_ROOT
      ? createRequire(resolve(process.env.TINYICO_ICOJS_ROOT, 'package.json')) : createRequire(import.meta.url);
    const entry = require.resolve('icojs');
    icojsVersion = JSON.parse(readFileSync(resolve(entry, '../../../package.json'), 'utf8')).version;
  }
  const report = {
    date: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch,
    cpu: cpus()[0]?.model, tinyicoVersion: JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version,
    icojsVersion, samples,
    fixtures: Object.fromEntries(Object.entries(fixtures).map(([name, data]) =>
      [name, { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }])),
    notes: [
      'Median of five sequential samples in a fresh process per library/case; preparation and assertions are untimed.',
      'tinyico loops are synchronous; icojs loops await each operation. The no-op baseline is reported, not subtracted.',
      'icojs has no public metadata-only API: that comparison is unavailable, rather than substituted with full decoding.',
      'Extraction uses a single-image container for equal output; encoding explicitly requests PNG entries in icojs.',
      'Each batch operation decodes 100 icons sequentially (50 PNG, 50 DIB); no concurrent Promise.all advantage.',
      'Memory is a separate experiment retaining 16 results; arrayBuffers is a subset of external, not additive.',
      'Process peak RSS includes startup, imports, fixtures, warmup, timing and memory sampling; it is not allocation per operation.',
      'Compression output size/filters can differ between libraries even when decoded pixels are identical.',
    ],
    results: [],
  };
  console.log(`Node ${report.node}; ${report.cpu}; icojs ${icojsVersion ?? 'unavailable'}`);
  console.log('case          library    median ms    us/op       ops/s       retained heap/external KiB    peak RSS MiB');
  for (const name of cases) {
    for (const library of comparator && name !== 'metadata' ? ['tinyico', 'icojs'] : ['tinyico']) {
      const result = await new Promise((resolveResult, reject) => {
        const child = fork(fileURLToPath(import.meta.url), ['--worker', name, library], {
          execArgv: ['--expose-gc'], stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        });
        let value;
        child.on('message', message => { value = message; });
        child.on('error', reject);
        child.on('exit', code => code === 0 && value ? resolveResult(value) : reject(new Error(`Benchmark worker failed (${name}/${library}, ${code})`)));
      });
      report.results.push(result);
      const mem = result.memory;
      const heap = (mem.retained.heapUsed - mem.before.heapUsed) / 1024;
      const external = (mem.retained.external - mem.before.external) / 1024;
      console.log(`${name.padEnd(13)} ${library.padEnd(10)} ${result.medianMs.toFixed(3).padStart(9)} ${result.microsecondsPerOperation.toFixed(3).padStart(10)} ${result.operationsPerSecond.toFixed(0).padStart(11)} ${`${heap.toFixed(1)} / ${external.toFixed(1)}`.padStart(29)} ${(mem.processPeakRss / 1048576).toFixed(1).padStart(13)}`);
    }
  }
  console.log(comparator ? 'icojs metadata: unavailable (no public equivalent).' : 'icojs not installed; see README for isolated optional setup.');
  report.notes.forEach(note => console.log(`- ${note}`));
  const output = process.argv.find(value => value.startsWith('--json='));
  if (output) writeFileSync(resolve(output.slice(7)), `${JSON.stringify(report, null, 2)}\n`);
}
