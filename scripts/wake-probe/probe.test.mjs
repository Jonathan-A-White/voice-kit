// Tests for the wake-word probe, its detector, the committed model and the document (stories mw-rdpwdp1.5 and
// mw-rdpwdp1.1). Network-free and tool-free: no espeak-ng, no ffmpeg, no scratch folder. Run by the root `npm test`
// (vitest's include names scripts/wake-probe/*.test.mjs), or alone: npx vitest run scripts/wake-probe
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { brownNoise, carMic, throughCar } from './handsfree.mjs';
import { rng } from './probe.mjs';
import { DEFAULT_PHRASE, PHRASES, phraseOf, phraseSlugFrom, scratchPaths, slugs, triesFolder } from './phrases.mjs';
import { createListener, FRONT_END, frameCount, listen, loadModel, logMel, poolFrames, scoreClip, wakes, windowEnd } from './detector.mjs';

const DOC = new URL('../../docs/wake-word-engines.md', import.meta.url);
const MODEL = new URL('../../examples/wake-spike/public/models/hey-lampas.json', import.meta.url);
const LICENCES = new URL('../../examples/wake-spike/public/models/licences.json', import.meta.url);
const FIXTURE = new URL('./fixtures/hey-lampas.wav', import.meta.url);
const ENGLISH = new URL('../../packages/testing/clips/english.wav', import.meta.url);

/** A 16-bit PCM WAV file's samples as floats in [-1, 1], and its rate and channels. */
function readWav(url) {
  const buf = readFileSync(url);
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
  let at = 12;
  let fmt = null;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(at + 10), rate: buf.readUInt32LE(at + 12), bits: buf.readUInt16LE(at + 22) };
    if (id === 'data') {
      assert.ok(fmt && fmt.bits === 16, 'a 16-bit PCM WAV');
      const n = Math.floor(size / 2 / fmt.channels);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(at + 8 + i * 2 * fmt.channels) / 32768;
      return { ...fmt, samples: out };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${url}`);
}

/** The rows of the first markdown table whose header starts with `start`. */
function tableAfter(text, start) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.startsWith(start));
  assert.ok(at >= 0, `the document has a table whose header starts with "${start}"`);
  const rows = [];
  for (const line of lines.slice(at + 2)) {
    if (!line.startsWith('|')) break;
    rows.push(line.slice(1, -1).split(' | ').map((c) => c.trim()));
  }
  return { header: lines[at].slice(1, -1).split(' | ').map((c) => c.trim()), rows };
}

const loaded = () => loadModel(JSON.parse(readFileSync(MODEL, 'utf8')));
// Scoring 30 s of audio takes about a second, but many times that on a host under heavy load: the default 5 s is too short.
const SCORING_TIMEOUT = 60_000;

// ---- the document ----

test('the document has the licence table: every row has a source URL, a licence, quoted words, a read-on date and a verdict', () => {
  const { header, rows } = tableAfter(readFileSync(DOC, 'utf8'), '| Route |');
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

test("the document has '## Trained model' with the measuring table, the bar met or not met beside each number, and a verdict", () => {
  const text = readFileSync(DOC, 'utf8');
  const at = text.indexOf('\n## Trained model\n');
  assert.ok(at >= 0, "a '## Trained model' section");
  const section = text.slice(at, text.indexOf('\n## ', at + 5));
  const { header, rows } = tableAfter(section, '| Measure |');
  assert.deepEqual(header, ['Measure', 'Result', "The Governor's bar", 'Met']);
  const names = rows.map((r) => r[0]).join('\n');
  for (const want of ['Measuring speech', 'False wakes', 'False wakes per hour', 'Misses, clean', 'Misses, under speech at 10 dB', 'Misses, under speech at 0 dB', 'Misses, under road-like noise at 5 dB', 'Delay, median', 'Delay, worst', 'Model bytes']) {
    assert.ok(names.includes(want), `the table has a row "${want}"`);
  }
  for (const row of rows) assert.match(row[3], /^(met|not met|-)$/, `row "${row[0]}" says met, not met or -`);
  assert.match(section, /What was tried/);
  assert.match(section, /route \(d\) (is|is not) good enough to build on/i);
});

// ---- the front end and the rule ----

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

test('poolFrames averages frames in pairs and drops a last odd one', () => {
  const pooled = poolFrames({ frames: 5, bands: 2, data: Float32Array.from([0, 10, 2, 12, 4, 14, 6, 16, 8, 18]) }, 2);
  assert.equal(pooled.frames, 2);
  assert.deepEqual(Array.from(pooled.data), [1, 11, 5, 15]);
});

test('wakes: the threshold met `consecutive` times in a row wakes once, then none for the refractory seconds', () => {
  const rule = { threshold: 0.5, consecutive: 2, refractory: 0.2 };
  assert.deepEqual(wakes([0.1, 0.9, 0.2, 0.95], rule, 0.04), []);
  assert.deepEqual(wakes([0.1, 0.9, 0.95, 0.99, 0.97, 0.2], rule, 0.04), [2]);
  // a second run inside the refractory 0.2 s (5 windows) is not a wake; one after it is
  assert.deepEqual(wakes([0.9, 0.9, 0, 0.9, 0.9, 0, 0, 0, 0, 0.9, 0.9], rule, 0.04), [1, 10]);
});

// ---- the committed model ----

test('detector.mjs imports nothing', () => {
  const source = readFileSync(new URL('./detector.mjs', import.meta.url), 'utf8');
  assert.deepEqual(source.split('\n').filter((l) => /^\s*import\b/.test(l) || /\bimport\(/.test(l) || /\brequire\(/.test(l)), []);
});

test('the committed model names its front end, rule, date and the commit that trained it, and loads', () => {
  const model = JSON.parse(readFileSync(MODEL, 'utf8'));
  assert.equal(model.phrase, 'Hey Lampas');
  assert.deepEqual(model.frontEnd, { ...FRONT_END });
  assert.ok(model.rule.threshold > 0 && model.rule.threshold < 1, 'a threshold between 0 and 1');
  assert.ok(model.rule.consecutive >= 1 && model.rule.refractory > 0);
  assert.match(model.trained.date, /^2026-\d\d-\d\d$/);
  assert.match(model.trained.commit, /^[0-9a-f]{40}$/);
  assert.ok(model.calibrated.setWithout.includes('measuring'), 'the threshold names what it was set without');
  const net = loaded();
  assert.ok(net.parameters > 1000);
});

test('licences.json lists every file and dataset with its source URL, licence, its own words and the date read; none non-commercial', () => {
  const { entries } = JSON.parse(readFileSync(LICENCES, 'utf8'));
  assert.ok(entries.length >= 6);
  const names = entries.map((e) => e.name).join('\n');
  for (const want of ['LibriSpeech', 'VCTK', 'tts_models/en/vctk/vits', 'coqui-tts', 'espeak-ng', 'FFmpeg', 'PyTorch']) assert.ok(names.includes(want), `lists ${want}`);
  for (const e of entries) {
    assert.match(e.url, /^https:\/\//, `${e.name} has a source URL`);
    assert.ok(e.licence.length > 2, `${e.name} has a licence`);
    assert.ok(e.words.length > 8, `${e.name} quotes the licence's words`);
    assert.match(e.readOn, /^2026-\d\d-\d\d$/, `${e.name} has a read-on date`);
    assert.doesNotMatch(`${e.licence} ${e.words}`, /non-?commercial|\bNC\b|unclear|unknown/i, `${e.name} is not non-commercial or unclear`);
  }
});

test("the committed model hears 'Hey Lampas' in a voice it never trained on exactly once", { timeout: SCORING_TIMEOUT }, () => {
  const net = loaded();
  const wav = readWav(FIXTURE);
  assert.equal(wav.rate, 16000);
  const padded = new Float32Array(wav.samples.length + 32000);
  padded.set(wav.samples, 16000);
  const heard = listen(net, padded);
  assert.equal(heard.length, 1, `heard ${heard.length} times`);
});

test('the committed model does not hear packages/testing/clips/english.wav, nor 30 s of silence', { timeout: SCORING_TIMEOUT }, () => {
  const net = loaded();
  const wav = readWav(ENGLISH);
  assert.equal(wav.rate, 16000);
  assert.deepEqual(listen(net, wav.samples), []);
  const silence = new Float32Array(16000 * 30);
  assert.deepEqual(listen(net, silence), []);
});

test('the listener gives the same scores fed in chunks as fed at once, and windowEnd says when each window is complete', { timeout: SCORING_TIMEOUT }, () => {
  const net = loaded();
  const wav = readWav(FIXTURE);
  const samples = new Float32Array(wav.samples.length + 32000);
  samples.set(wav.samples, 16000);
  const whole = scoreClip(net, samples);
  const listener = createListener(net, { keepScores: true });
  for (let at = 0; at < samples.length; at += 1234) listener.push(samples.subarray(at, at + 1234));
  assert.deepEqual(listener.scores, whole);
  assert.ok(whole.length > 0);
  assert.ok(Math.abs(windowEnd(net, 0) - (FRONT_END.win + FRONT_END.hop * (net.window * FRONT_END.pool - 1)) / FRONT_END.rate) < 1e-9);
});

test("the committed model hears 'Hey Lampas' through a car's narrowband hands-free microphone, with road noise at 5 dB, exactly once", { timeout: SCORING_TIMEOUT }, async () => {
  const net = loaded();
  const wav = readWav(FIXTURE);
  const lead = 3 * 16000;
  const random = rng(8);
  for (const road of [undefined, 5]) {
    const voice = new Float32Array(lead + wav.samples.length + 2 * 16000);
    voice.set(wav.samples, lead + 16000);
    const level = Math.sqrt(wav.samples.reduce((a, v) => a + v * v, 0) / wav.samples.length);
    const mic = carMic(voice, { road: road === undefined ? null : brownNoise(random, voice.length), roadDb: road, level });
    const [heard] = await throughCar(random, [mic], 'nb', { preroll: lead });
    assert.equal(listen(net, heard).length, 1, `heard ${listen(net, heard).length} times (road ${road})`);
  }
});

// ---- the phrases (story mw-deiheir.1) ----

const PROBE = fileURLToPath(new URL('./probe.mjs', import.meta.url));

test("the phrase table has 'hey-lampas' and 'hey-postern', and Hey Lampas is the default", () => {
  assert.deepEqual(slugs(), ['hey-lampas', 'hey-postern']);
  assert.equal(DEFAULT_PHRASE, 'hey-lampas');
  assert.equal(phraseOf().slug, 'hey-lampas');
  assert.equal(phraseOf('hey-postern').slug, 'hey-postern');
});

test("'hey-lampas' holds what main held before the table: its model, fixture, spellings and near words", () => {
  const lampas = PHRASES['hey-lampas'];
  assert.equal(lampas.model, 'examples/wake-spike/public/models/hey-lampas.json');
  assert.equal(lampas.fixture, 'scripts/wake-probe/fixtures/hey-lampas.wav');
  assert.equal(lampas.results, 'examples/wake-spike/results.json');
  assert.deepEqual(lampas.spellings, ['Hey Lampas', 'Hey, Lampas', 'Hey Lampas.', 'Hey Lampas!', 'hey lampas']);
  assert.deepEqual(lampas.near, [
    'Hey', 'Hey Lamp', 'Hey lamb', 'Hey campus', 'Hey Postern', 'Hey buddy', 'Hey Lucas', 'Hey Thomas', 'Hey lampshade',
    'Hey glasses', 'Lampas', 'Hey Las Vegas', 'Hey Lambert', 'Hey Atlas', 'Hey alarm', 'Okay, Lampas', 'Hello',
    'Play', 'Pause', 'Stop', 'Next chapter', 'Previous chapter', 'Back a verse', 'Open John three', 'Hey Linda',
    'Hey llama', 'Hey Lana', 'Hey Pampas', 'Hey Tampa', 'Hey canvas', 'Hey lemon', 'Hey, let us pass', 'Hey Alexa',
    'Hey Google', 'Hey Siri', 'Hey Lambo', 'Hey Lamar', 'Hey lamplight', 'Hey compass', 'Hey Douglas', 'Hey palace',
    'Hey Nicholas', 'Hey Marcus', 'A lamp post', 'The lamp is on', 'Hey, pass the lamp', 'Hey there', 'Hey you',
  ]);
});

test("'hey-postern' holds its five spellings and every near word the story names, and its own model, fixture and results", () => {
  const postern = PHRASES['hey-postern'];
  assert.deepEqual(postern.spellings, ['Hey Postern', 'Hey, Postern', 'Hey Postern.', 'Hey Postern!', 'hey postern']);
  for (const word of ['Postern', 'pastor', 'Hey pastor', 'poster', 'Hey poster', 'posture', 'postman', 'post', 'Boston', 'Hey Boston', 'Preston', 'possum', 'Hey Austin', 'Hey Lampas', 'Hello', 'Okay, Postern']) {
    assert.ok(postern.near.includes(word), `near words hold ${word}`);
  }
  for (const spelling of postern.spellings) assert.ok(!postern.near.includes(spelling), `${spelling} is the phrase, not a near word`);
  assert.equal(postern.model, 'examples/wake-spike/public/models/hey-postern.json');
  assert.equal(postern.fixture, 'scripts/wake-probe/fixtures/hey-postern.wav');
  assert.equal(postern.results, 'examples/wake-spike/results-hey-postern.json');
});

test('the phrase-free speech features have the same paths for both phrases; the sayings and what is made from them differ', () => {
  const a = scratchPaths('hey-lampas', '/r');
  const b = scratchPaths('hey-postern', '/r');
  for (const key of ['shared', 'sets', 'speechPool', 'streamFeatures', 'streamInfo', 'hfStreamFeatures', 'hfStreamInfo']) assert.equal(a[key], b[key], key);
  for (const key of ['sayings', 'vits', 'feat', 'modelTrained']) assert.notEqual(a[key], b[key], key);
  // Hey Lampas's files stay where they were made before the table
  assert.equal(a.sayings, '/r/route-d/sayings');
  assert.equal(a.feat, '/r/route-d/feat');
  assert.equal(a.modelTrained, '/r/route-d/model-trained.json');
  assert.equal(a.streamFeatures, '/r/route-d/feat/stream.f32');
  assert.equal(b.sayings, '/r/route-d/phrases/hey-postern/sayings');
  assert.equal(triesFolder('hey-lampas'), 'tries');
  assert.equal(triesFolder('hey-postern'), 'tries-hey-postern');
});

test('--phrase is read from an argument list, and Hey Lampas is the default', () => {
  assert.equal(phraseSlugFrom(['measure']), 'hey-lampas');
  assert.equal(phraseSlugFrom(['measure', '--phrase', 'hey-postern']), 'hey-postern');
  assert.equal(phraseSlugFrom(['--phrase=hey-postern', '--quick']), 'hey-postern');
});

test('an unknown phrase exits 2 and lists the slugs; --help names --phrase', () => {
  const bad = spawnSync(process.execPath, [PROBE, 'measure', '--phrase', 'nothing'], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr + bad.stdout, /hey-lampas/);
  assert.match(bad.stderr + bad.stdout, /hey-postern/);
  const help = spawnSync(process.execPath, [PROBE, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--phrase/);
  for (const command of ['prepare', 'prepare-hf', 'train', 'calibrate', 'measure']) {
    const r = spawnSync(process.execPath, [PROBE, command, '--phrase', 'nothing'], { encoding: 'utf8' });
    assert.equal(r.status, 2, command);
  }
});
