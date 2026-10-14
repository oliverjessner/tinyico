// Documentation assets only. Existing measurements + Node.js built-ins; no dependencies.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(new URL('./results.json', import.meta.url), 'utf8'));
const output = new URL('../docs/assets/', import.meta.url);
mkdirSync(output, { recursive: true });
const colors = { ink: '#172538', muted: '#526074', grid: '#dce2e9', blue: '#2860bb', orange: '#b76418', soft: '#f2f5f9' };
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const number = value => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const text = (x, y, value, size = 28, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${escape(value)}</text>`;
const line = (x1, y1, x2, y2, stroke = colors.grid) => `<path d="M${x1} ${y1}H${x2}V${y2}" fill="none" stroke="${stroke}" stroke-width="1.5"/>`;
const rect = (x, y, width, height, fill, radius = 0) => `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"/>`;

function save(name, title, description, height, body) {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="${height}" viewBox="0 0 720 ${height}" role="img" aria-labelledby="title description">
<title id="title">${escape(title)}</title>
<desc id="description">${escape(description)}</desc>
<rect width="720" height="${height}" fill="#fff"/>
<g font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" fill="${colors.ink}">
${body}
</g>
</svg>
`;
  writeFileSync(new URL(name, output), svg);
}

// Pixel-window mark, built from simple vector shapes without external assets.
let mark = rect(32, 36, 112, 112, colors.ink, 18);
mark += rect(48, 52, 80, 16, colors.blue) + rect(48, 76, 32, 16, colors.orange);
mark += rect(88, 76, 40, 16, '#fff') + rect(48, 100, 16, 32, '#fff') + rect(72, 100, 56, 32, colors.blue);
save('tinyico.svg', 'tinyico', 'ICO and CUR processing for Node.js. Zero dependencies.', 200,
  mark + text(176, 108, 'tinyico', 76, 'font-weight="650" letter-spacing="-3"') +
  text(180, 153, 'ICO / CUR · NODE.JS · ZERO DEPS', 28));

const box = (x, y, width, title, labels) => rect(x, y, width, 132, colors.soft, 12) +
  text(x + width / 2, y + 43, title, 28, 'text-anchor="middle" font-weight="600"') +
  labels.map((label, index) => text(x + width / 2, y + 80 + index * 32, label, 28, 'text-anchor="middle"')).join('');
const arrow = (x, y, end) => `<path d="M${x} ${y}V${end}M${x - 6} ${end - 8}L${x} ${end}L${x + 6} ${end - 8}" fill="none" stroke="${colors.muted}" stroke-width="2"/>`;
save('data-flow.svg', 'Extract one image',
  'Read ICO/CUR headers and select an entry without decoding other images. PNG entries are validated and passed through unchanged. DIB entries are decoded to RGBA and encoded as PNG.', 818,
  text(32, 52, 'Extract one image', 34, 'font-weight="600"') +
  box(32, 88, 656, 'ICO / CUR buffer', ['One file, multiple image entries']) + arrow(360, 220, 256) +
  box(32, 256, 656, 'Read headers · choose entry', ['No pixel decoding at this stage']) +
  `<path d="M360 388V412H188V440M360 412H532V440" fill="none" stroke="${colors.muted}" stroke-width="2"/>` +
  box(32, 440, 312, 'PNG entry', ['Validate chunks', 'Pass bytes through']) +
  box(376, 440, 312, 'DIB entry', ['Decode RGBA', 'Encode PNG']) +
  `<path d="M188 572V600H532V572M360 600V636" fill="none" stroke="${colors.muted}" stroke-width="2"/>` +
  box(32, 636, 656, 'PNG buffer', ['PNG passthrough may share input memory']) +
  text(32, 802, 'Only the selected entry is processed.', 28));

const cases = [
  { key: 'png-extract', title: 'PNG extraction · 32 × 32', unit: 'µs', divisor: 1 },
  { key: 'dib-to-png', title: 'DIB → PNG · 32 × 32', unit: 'µs', divisor: 1 },
  { key: 'encode', title: 'ICO creation · 16 / 32 / 256', unit: 'µs', divisor: 1 },
  { key: 'batch', title: 'Batch · 100 icons', unit: 'ms', divisor: 1000 },
];
const libraries = ['tinyico', 'icojs'];
const rows = cases.map(item => libraries.map(library => {
  const row = report.results.find(row => row.case === item.key && row.library === library);
  assert.ok(row, `Missing ${item.key}/${library} measurement in bench/results.json`);
  assert.equal(row.elapsedMs.length, report.samples);
  const times = row.elapsedMs.map(value => value * 1000 / row.iterations / item.divisor).sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  assert.ok(Math.abs(median - row.microsecondsPerOperation / item.divisor) < 1e-8);
  assert.ok(median > 0 && times.every(Number.isFinite));
  return { ...row, median, low: times[0], high: times.at(-1) };
}));
const niceMax = value => {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find(step => step * magnitude >= value) * magnitude;
};
const memoryMax = niceMax(Math.max(...rows.flat().map(row => row.memory.processPeakRss / 1048576)) * 1.04);

function panel(item, measurements, y, memory = false) {
  const max = memory ? memoryMax : niceMax(Math.max(...measurements.map(row => row.high)) * 1.04);
  const x = 180, width = 330, valueX = 688;
  let content = text(32, y, item.title, 28, 'font-weight="600"');
  for (const [index, row] of measurements.entries()) {
    const baseline = y + 43 + index * 46;
    const value = memory ? row.memory.processPeakRss / 1048576 : row.median;
    assert.ok(value <= max, 'Chart domain must include every value');
    content += text(32, baseline + 8, row.library);
    content += rect(x, baseline - 16, value / max * width, 28, index === 0 ? colors.blue : colors.orange);
    content += text(valueX, baseline + 8, number(value), 28, 'text-anchor="end"');
    if (!memory) {
      const left = x + row.low / max * width, right = x + row.high / max * width;
      content += `<path d="M${left} ${baseline - 7}V${baseline + 3}M${left} ${baseline - 2}H${right}M${right} ${baseline - 7}V${baseline + 3}" stroke="${colors.ink}" fill="none" stroke-width="1.5"/>`;
    }
  }
  const axis = y + 124;
  content += line(x, y + 20, x, axis, colors.muted) + line(x, axis, x + width, axis, colors.muted);
  for (const tick of [0, max / 2, max]) {
    const tickX = x + tick / max * width;
    content += line(tickX, axis, tickX, axis + 5, colors.muted) +
      text(tickX, axis + 34, tick.toLocaleString('en-US'), 28, 'text-anchor="middle"');
  }
  return content + text(valueX, axis + 34, memory ? 'MiB' : `${item.unit} / op`, 28, 'text-anchor="end"');
}

const context = `${report.cpu} · Node ${report.node}`;
const date = new Date(report.date).toISOString().slice(0, 10);
const descriptions = rows.flat().map(row => `${row.case}, ${row.library}: ${number(row.median)} ${cases.find(item => item.key === row.case).unit} per operation.`).join(' ');
save('benchmark-time.svg', 'ICO processing time',
  `${descriptions} Median of ${report.samples} timed samples. Whiskers show observed minimum and maximum, not confidence intervals. Each panel has an independent zero-based scale. Synthetic fixtures measured ${date}.`, 1030,
  text(32, 52, 'ICO processing time', 34, 'font-weight="600"') +
  text(32, 94, context) + text(32, 132, `Median of ${report.samples} samples · lower is better`) +
  cases.map((item, index) => panel(item, rows[index], 195 + index * 190)).join('') +
  text(32, 958, 'Each panel has its own zero-based scale.') +
  text(32, 997, `Whiskers: sample min–max · ${date}`));
save('benchmark-memory.svg', 'Process peak memory',
  `Peak resident memory in MiB for each library and operation, using a common zero-based scale. Includes process startup, imports, fixtures, timing and retention phases; not allocation per operation. Measured ${date}.`, 1030,
  text(32, 52, 'Process peak memory', 34, 'font-weight="600"') +
  text(32, 94, context) + text(32, 132, 'Whole-process peak RSS · common scale') +
  cases.map((item, index) => panel(item, rows[index], 195 + index * 190, true)).join('') +
  text(32, 958, 'Includes startup, imports and all phases.') +
  text(32, 997, `Not allocation per operation · ${date}`));
console.log('Wrote four SVG documentation assets from bench/results.json.');
