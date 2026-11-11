// Tests for the wake-word probe and its document (story mw-rdpwdp1.5). Network-free and model-free.
// Run: node --test scripts/wake-probe/probe.test.mjs
// They are not in the root vitest run (its include stops at scripts/*.test.mjs), so run them by hand.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createMlp, detect, forward, frameCount, logMel, windowsOf } from './probe.mjs';

const DOC = new URL('../../docs/wake-word-engines.md', import.meta.url);

/** The rows of the first markdown table whose header starts with '| Route |'. */
function tableRows(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith('| Route |'));
  assert.ok(start >= 0, 'the document has a table whose header starts with "| Route |"');
  const rows = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(line.slice(1, -1).split(' | ').map((c) => c.trim()));
  }
  return { header: lines[start].slice(1, -1).split(' | ').map((c) => c.trim()), rows };
}

test('the document has the licence table: every row has a source URL, a licence, quoted words, a read-on date and a verdict', () => {
  const { header, rows } = tableRows(readFileSync(DOC, 'utf8'));
  assert.deepEqual(header, ['Route', 'File', 'What it is', 'Source URL', 'Licence', "The licence's own words", 'Read on', 'Verdict']);
  assert.ok(rows.length >= 12, `at least 12 rows, found ${rows.length}`);
  for (const row of rows) {
    const [route, file, , url, licence, words, readOn, verdict] = row;
    const at = `row "${route} ${file}"`;
    assert.equal(row.length, 8, `${at} has 8 cells`);
    assert.match(route, /^\((a|b|c|d)\)/, `${at} names its route`);
    assert.match(url, /https:\/\//, `${at} has a source URL`);
    assert.ok(licence.length > 2, `${at} has a licence name`);
    assert.match(words, /"[^"]{8,}"/, `${at} quotes the licence's own words`);
    assert.match(readOn, /^2026-\d\d-\d\d$/, `${at} has a read-on date`);
    assert.match(verdict, /^(permissive|NOT CLEAN|UNVERIFIED|not used)/, `${at} has a verdict`);
  }
  for (const r of ['a', 'b', 'c', 'd']) assert.ok(rows.some((row) => row[0].startsWith(`(${r})`)), `route (${r}) has rows`);
});

test('each route (a) to (d) has a verdict of CLEAN, NOT CLEAN or UNVERIFIED, with a reason', () => {
  const text = readFileSync(DOC, 'utf8');
  for (const r of ['a', 'b', 'c', 'd']) {
    const m = text.match(new RegExp(`^### Route \\(${r}\\)[^\\n]*\\n+\\*\\*Verdict: (CLEAN|NOT CLEAN|UNVERIFIED)\\*\\*(.*)$`, 'm'));
    assert.ok(m, `route (${r}) has a '### Route (${r})' heading followed by a '**Verdict: ...**' line`);
    assert.ok(m[2].trim().length > 20, `route (${r})'s verdict gives a reason`);
  }
});

test('each CLEAN route states training, time and disk, download bytes, how it runs in a browser and the command set', () => {
  const text = readFileSync(DOC, 'utf8');
  const sections = text.split(/^### /m).filter((s) => s.startsWith('Route ('));
  const clean = sections.filter((s) => /\*\*Verdict: CLEAN\*\*/.test(s));
  for (const s of clean) {
    for (const label of ['Training needed:', 'Training time and disk on the laptop:', 'Browser download:', 'In a browser:', 'The first command set:']) {
      assert.ok(s.includes(`- ${label}`), `${s.split('\n')[0]} states "${label}"`);
    }
    assert.match(s, /\((measured|estimated)[^)]*\)/, `${s.split('\n')[0]} says whether its numbers are measured or estimated`);
  }
});

test("the document ends with '## Recommendation', naming what is the Governor's to decide", () => {
  const text = readFileSync(DOC, 'utf8');
  const h2 = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.equal(h2.at(-1), 'Recommendation');
  const rec = text.slice(text.lastIndexOf('## Recommendation'));
  assert.match(rec, /Governor's to decide/);
  assert.match(rec, /next story/i);
});

test('logMel: one frame per 10 ms after the first 25 ms, and a 1 kHz tone is loudest in the band that holds 1 kHz', () => {
  const rate = 16000;
  const samples = new Float32Array(rate);
  for (let i = 0; i < samples.length; i++) samples[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / rate);
  const { frames, bands, data, centres } = logMel(samples);
  assert.equal(frames, frameCount(samples.length));
  assert.equal(frames, 1 + Math.floor((rate - 400) / 160));
  const mid = Math.floor(frames / 2);
  let best = 0;
  for (let b = 1; b < bands; b++) if (data[mid * bands + b] > data[mid * bands + best]) best = b;
  const nearest = centres.reduce((bi, c, i) => (Math.abs(c - 1000) < Math.abs(centres[bi] - 1000) ? i : bi), 0);
  assert.ok(Math.abs(best - nearest) <= 1, `loudest band ${best} (${centres[best]} Hz) is next to ${nearest} (${centres[nearest]} Hz)`);
});

test('windowsOf: windows of a fixed length every hop frames, and a short clip is padded to one window', () => {
  const bands = 2;
  const mel = { frames: 5, bands, data: Float32Array.from({ length: 10 }, (_, i) => i) };
  const w = windowsOf(mel, 3, 2);
  assert.equal(w.length, 2);
  assert.equal(w[0].length, 3 * bands);
  const short = windowsOf({ frames: 1, bands, data: new Float32Array([1, 2]) }, 3, 2);
  assert.equal(short.length, 1);
  assert.equal(short[0].length, 3 * bands);
});

test('forward is deterministic for a seeded network and gives a probability; detect needs the threshold met twice in a row', () => {
  const a = createMlp(6, 4, 7);
  const b = createMlp(6, 4, 7);
  const x = new Float32Array([0.1, -0.2, 0.3, 0.4, -0.5, 0.6]);
  const p = forward(a, x);
  assert.equal(p, forward(b, x));
  assert.ok(p > 0 && p < 1);
  assert.deepEqual(detect([0.1, 0.9, 0.2, 0.95], 0.5), { heard: false, best: 0.95, at: -1 });
  assert.deepEqual(detect([0.1, 0.9, 0.95, 0.2], 0.5), { heard: true, best: 0.95, at: 2 });
});
