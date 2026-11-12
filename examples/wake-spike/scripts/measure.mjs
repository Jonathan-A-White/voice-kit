// Measures the wake detector headless and writes examples/wake-spike/results.json:
//
//   npm run measure --workspace wake-spike        (from the repo root; run it as `nice -n 10 npm run ...`)
//   node examples/wake-spike/scripts/measure.mjs --model FILE --out FILE --quick
//       measures another model file (the committed one's older self, say), writes the numbers to --out and leaves
//       results.json alone; --quick skips compute (Node and Chromium), which does not depend on the training.
//
//   (a) false wakes over the cached Bible audio, as a count and per hour, with the minutes;
//   (b) misses in each set of 20 tries (clean; under Bible audio at 10 dB and at 0 dB; under brown noise at 5 dB);
//   (c) the delay from the phrase's end to the wake, median and worst, over the tries that woke;
//   (d) the bytes of every model file and their gzip size;
//   (e) compute, in milliseconds per second of audio, in Node and in headless Chromium with the CPU throttled 4x (a
//       phone proxy). Battery is NOT measured here: it needs a phone.
//   (f) for a car's Bluetooth hands-free microphone (story mw-rdpwdp1.12): the sets of tries made through the car's
//       noise suppressor, gain and a narrowband or wideband link (they are in (b)), and the false wakes while the Bible
//       leaks through the car, narrowband and wideband, an hour of it each.
//
// It reads the detector from src/detector.ts (the file the page runs, transpiled to plain JavaScript), the model from
// public/models, the Bible audio fetch-bible-audio.mjs cached and the tries make-tries.mjs made (it makes any set that
// is missing). Faster than real time; one run at a time. The exit code is 0 when the numbers were written, whether or
// not they meet the bar: the bar is printed beside them.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import ts from 'typescript';
import { chromium } from 'playwright-core';
import { HANDSFREE_CONDITIONS, carMic, throughCar } from '../../../scripts/wake-probe/handsfree.mjs';
import { decode, rms, rng } from '../../../scripts/wake-probe/probe.mjs';
import { DEFAULT_DIR, cachedFiles } from './fetch-bible-audio.mjs';
import { SETS, brownNoise, makeTries, readSet } from './make-tries.mjs';

const HERE = fileURLToPath(new URL('..', import.meta.url));
const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const MODELS = join(HERE, 'public', 'models');
export const RESULTS = join(HERE, 'results.json');
export const SOURCE = join(HERE, 'src', 'detector.ts');

// The Governor's bar (question 6, mw-6ww.165): at most 1 false wake an hour while the Bible plays, at most 2 misses in 20.
export const BAR = { label: "the Governor's bar (question 6, mw-6ww.165)", falseWakesPerHour: 1, missesIn20: 2, bibleMinutes: 60 };
const CHUNK = 4096; // samples per push: what the page's worklet sends
const BENCH_SECONDS = 30;
const WARMUP_SECONDS = 5;

/** src/detector.ts as an ES module in a scratch folder, imported: the very code the page bundles. */
export async function loadDetector() {
  const dir = mkdtempSync(join(tmpdir(), 'wake-measure-'));
  const js = ts.transpileModule(readFileSync(SOURCE, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const file = join(dir, 'detector.mjs');
  writeFileSync(file, js);
  const module = await import(pathToFileURL(file).href);
  return { module, js, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
}

/** A try is heard when a wake falls between the saying's start and 1 s after the phrase's end; the delay is from that end. */
export function judgeTry(wakes, start, end) {
  const hit = wakes.find((w) => w.time >= start && w.time <= end + 1);
  return hit ? { heard: true, delay: hit.time - end } : { heard: false };
}

/** Pushes all of `audio` through `detector` in worker-sized chunks; every wake found. */
function pushAll(detector, audio, input = CHUNK) {
  const found = [];
  for (let at = 0; at < audio.length; at += input) found.push(...detector.push(audio.subarray(at, at + input)));
  return found;
}

/** (a) One detector over every cached chapter in turn, as if the Bible played on without a break. */
async function soak(D, net, files) {
  const detector = D.createDetector(net);
  const wakes = [];
  let seconds = 0;
  const t0 = Date.now();
  for (const file of files) {
    const audio = await decode(file);
    // w.time is already seconds from the start of the whole stream; `seconds` here is where this chapter began in it
    for (const w of pushAll(detector, audio)) wakes.push({ at: w.time, inFile: w.time - seconds, score: w.score, file: file.split('/').pop() });
    seconds += audio.length / 16000;
  }
  return { minutes: seconds / 60, wakes, files: files.length, stats: detector.stats(), wallSeconds: (Date.now() - t0) / 1000 };
}

/**
 * (f) The Bible through a car: each chapter is the leak at the microphone with nobody talking, road noise (brown) under
 * it in three blocks of four, 10, 5 and 0 dB under the Bible, none in the fourth; through the car's noise suppressor,
 * gain and the link, a fresh car's settings for every minute. One detector over all of it, as in (a).
 */
async function soakHandsfree(D, net, files, link) {
  const detector = D.createDetector(net);
  const random = rng(link === 'nb' ? 41 : 42);
  const roads = [undefined, 10, 5, 0];
  const wakes = [];
  let seconds = 0;
  let block = 0;
  const t0 = Date.now();
  for (const file of files) {
    const audio = await decode(file);
    const mic = new Float32Array(audio.length);
    for (let at = 0; at < audio.length; at += 60 * 16000) {
      const leak = audio.slice(at, at + 60 * 16000);
      const road = roads[block++ % roads.length];
      mic.set(carMic(new Float32Array(leak.length), { road: road === undefined ? null : brownNoise(random, leak.length), roadDb: road, leak, leakDb: 0, level: 0.1 }), at);
    }
    const [heard] = await throughCar(random, [mic], link); // one car's settings for the chapter
    // w.time is already seconds from the start of the whole stream; `seconds` here is where this chapter began in it
    for (const w of pushAll(detector, heard)) wakes.push({ at: w.time, inFile: w.time - seconds, score: w.score, file: file.split('/').pop() });
    seconds += audio.length / 16000;
  }
  return { link, minutes: seconds / 60, wakes, files: files.length, wallSeconds: (Date.now() - t0) / 1000 };
}

/** (b) and (c) Each set of 20 tries, a fresh detector for each try. */
async function trySets(D, net) {
  const missing = SETS.filter((set) => !existsSync(join(DEFAULT_DIR, '..', 'tries', `${set.key}.json`)));
  if (missing.length) await makeTries();
  return SETS.map((set) => {
    const { tries, name } = readSet(set.key);
    const delays = [];
    let misses = 0;
    for (const t of tries) {
      const j = judgeTry(pushAll(D.createDetector(net), t.samples), t.start, t.end);
      if (j.heard) delays.push(j.delay * 1000);
      else misses++;
    }
    return { key: set.key, name, tries: tries.length, misses, delaysMs: delays.map((d) => Math.round(d)) };
  });
}

/** (d) Every model file's bytes and gzip bytes (level 9). The licence list beside it is documentation, not a model. */
function modelBytes() {
  const files = readdirSync(MODELS)
    .filter((name) => name !== 'licences.json')
    .sort()
    .map((name) => {
      const body = readFileSync(join(MODELS, name));
      return { name, bytes: body.length, gzipBytes: gzipSync(body, { level: 9 }).length };
    });
  return { files, bytes: files.reduce((a, f) => a + f.bytes, 0), gzipBytes: files.reduce((a, f) => a + f.gzipBytes, 0) };
}

/** 30 s of Bible speech (after the first minute) as 16 kHz floats, and the same brought up to 48 kHz as a phone captures it. */
async function benchAudio(D, file) {
  const audio = (await decode(file)).slice(60 * 16000, (60 + BENCH_SECONDS + WARMUP_SECONDS) * 16000);
  const up = D.createResampler(16000, 48000).push(audio);
  return { rate16: audio, rate48: up };
}

/** Compute in Node: wall milliseconds around the whole push loop per second of audio, after a warm-up on the first seconds. */
function nodeCompute(D, net, audio, rate) {
  const warm = D.createDetector(net, { inputRate: rate });
  pushAll(warm, audio.subarray(0, WARMUP_SECONDS * rate));
  const body = audio.subarray(WARMUP_SECONDS * rate);
  const detector = D.createDetector(net, { inputRate: rate });
  const t0 = performance.now();
  pushAll(detector, body);
  const ms = performance.now() - t0;
  return { msPerSecond: ms / (body.length / rate), counterMsPerSecond: detector.stats().msPerSecond, audioSeconds: body.length / rate };
}

const extraLibDir = join(homedir(), '.cache', 'ms-playwright-system-libs', 'usr', 'lib', 'x86_64-linux-gnu');
const toBase64 = (floats) => Buffer.from(floats.buffer, floats.byteOffset, floats.byteLength).toString('base64');

/** Compute in headless Chromium at 1x and with the CPU throttled 4x (CDP Emulation.setCPUThrottlingRate), 48 kHz input, on the page's main thread. */
async function chromiumCompute(js, model, audio48) {
  const env = existsSync(extraLibDir) ? { ...process.env, LD_LIBRARY_PATH: [extraLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') } : undefined;
  const browser = await chromium.launch({ channel: 'chromium', env });
  try {
    const context = await browser.newContext();
    await context.route('https://measure.test/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/detector.js') return route.fulfill({ contentType: 'text/javascript', body: js });
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><script type="module">import * as d from "/detector.js"; window.__detector = d;</script>' });
    });
    const page = await context.newPage();
    await page.goto('https://measure.test/');
    await page.waitForFunction(() => Boolean(window.__detector));
    const cdp = await context.newCDPSession(page);
    const run = async (rate) => {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      return page.evaluate(
        ({ model: json, audioBase64, inputRate, chunk, warmup }) => {
          const d = window.__detector;
          const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
          const audio = new Float32Array(bytes.buffer);
          const net = d.loadModel(json);
          const pushAll = (detector, samples) => {
            for (let at = 0; at < samples.length; at += chunk) detector.push(samples.subarray(at, at + chunk));
          };
          pushAll(d.createDetector(net, { inputRate }), audio.subarray(0, warmup * inputRate));
          const body = audio.subarray(warmup * inputRate);
          const detector = d.createDetector(net, { inputRate });
          const t0 = performance.now();
          pushAll(detector, body);
          const ms = performance.now() - t0;
          return { msPerSecond: ms / (body.length / inputRate), counterMsPerSecond: detector.stats().msPerSecond, audioSeconds: body.length / inputRate };
        },
        { model, audioBase64: toBase64(audio48), inputRate: 48000, chunk: CHUNK, warmup: WARMUP_SECONDS },
      );
    };
    const unthrottled = await run(1);
    const throttled = await run(4);
    return { unthrottled, throttled4x: throttled, version: browser.version() };
  } finally {
    await browser.close();
  }
}

const fixed = (n, digits = 2) => n.toFixed(digits);
const group = (n) => n.toLocaleString('en-GB');

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** The rows of the table: [measure, result, target, met]. */
export function tableRows(r) {
  const rows = [];
  const row = (measure, result, target = '-', met = null) => rows.push({ measure, result, target, met: met === null ? '-' : met ? 'met' : 'not met' });
  row('Bible audio played', `${fixed(r.bible.minutes, 1)} min of John (${r.bible.files} chapters, recorded voice)`, `at least ${BAR.bibleMinutes} min`, r.bible.minutes >= BAR.bibleMinutes);
  row('False wakes', `${r.bible.falseWakes} in ${fixed(r.bible.minutes, 1)} min`);
  row('False wakes an hour', fixed(r.bible.falseWakesPerHour), `at most ${BAR.falseWakesPerHour}`, r.bible.falseWakesPerHour <= BAR.falseWakesPerHour);
  for (const [name, h] of Object.entries(r.bible.throughTheCar ?? {})) {
    row(`False wakes an hour, Bible through the car, ${name}`, `${fixed(h.falseWakesPerHour)} (${h.falseWakes} in ${fixed(h.minutes, 1)} min)`, `at most ${BAR.falseWakesPerHour}`, h.falseWakesPerHour <= BAR.falseWakesPerHour);
  }
  for (const set of r.tries.sets) row(`Misses, ${set.name}`, `${set.misses} in ${set.tries}`, `at most ${BAR.missesIn20} in 20`, set.misses <= BAR.missesIn20);
  row('Delay from the phrase end to the wake, median', `${r.tries.delayMedianMs} ms (${r.tries.heard} tries that woke)`);
  row('Delay, worst', `${r.tries.delayWorstMs} ms`);
  row('Model size', `${group(r.model.bytes)} bytes, ${group(r.model.gzipBytes)} gzipped (${r.model.files.map((f) => f.name).join(', ')})`);
  row('Compute in Node', `${fixed(r.compute.node.msPerSecond)} ms per second of audio (16 kHz in); ${fixed(r.compute.node48k.msPerSecond)} with 48 kHz in`);
  row('Compute in Chromium', `${fixed(r.compute.chromium.unthrottled.msPerSecond)} ms per second of audio (48 kHz in, page main thread)`);
  row('Compute in Chromium, CPU throttled 4x', `${fixed(r.compute.chromium.throttled4x.msPerSecond)} ms per second of audio (a phone proxy)`);
  row('Battery', 'not measured: it needs a phone, not a headless run');
  return rows;
}

export function printTable(rows, markdown) {
  const header = ['Measure', 'Result', `Target (${BAR.label})`, 'Met'];
  const cells = rows.map((r) => [r.measure, r.result, r.target, r.met]);
  if (markdown) return [`| ${header.join(' | ')} |`, '|---|---|---|---|', ...cells.map((c) => `| ${c.join(' | ')} |`)].join('\n');
  const widths = [0, 1, 2, 3].map((i) => Math.max(header[i].length, ...cells.map((c) => c[i].length)));
  return [header, ...cells].map((c) => c.map((cell, i) => cell.padEnd(widths[i])).join('  ')).join('\n');
}

export async function measure({ markdown = false, modelFile = join(MODELS, 'hey-lampas.json'), out = RESULTS, quick = false } = {}) {
  const started = Date.now();
  const files = cachedFiles();
  if (files.length === 0) throw new Error(`no Bible audio in ${DEFAULT_DIR}: run node examples/wake-spike/scripts/fetch-bible-audio.mjs first`);
  const { module: D, js, cleanup } = await loadDetector();
  try {
    const modelJson = JSON.parse(readFileSync(modelFile, 'utf8'));
    const net = D.loadModel(modelJson);
    console.log(`measure: ${files.length} chapters of John cached; model trained ${modelJson.trained.date} at ${modelJson.trained.commit.slice(0, 9)}, rule ${JSON.stringify(net.rule)}`);

    const bible = await soak(D, net, files);
    console.log(`measure: soak: ${fixed(bible.minutes, 1)} min of Bible audio scored in ${fixed(bible.wallSeconds, 0)} s, ${bible.wakes.length} wakes`);
    const sets = await trySets(D, net);
    console.log(`measure: tries: ${sets.map((s) => `${s.key} ${s.misses} missed`).join(', ')}`);
    const delays = sets.flatMap((s) => s.delaysMs);

    const handsfree = {};
    for (const link of ['nb', 'wb']) {
      handsfree[link] = await soakHandsfree(D, net, files, link);
      console.log(`measure: soak through the car, ${link === 'nb' ? 'narrowband' : 'wideband'}: ${fixed(handsfree[link].minutes, 1)} min scored in ${fixed(handsfree[link].wallSeconds, 0)} s, ${handsfree[link].wakes.length} wakes`);
    }

    let node;
    let node48k;
    let chromiumResult;
    if (quick) {
      node = node48k = { msPerSecond: NaN };
      chromiumResult = { unthrottled: { msPerSecond: NaN }, throttled4x: { msPerSecond: NaN }, version: 'skipped' };
    } else {
      const bench = await benchAudio(D, files[0]);
      node = nodeCompute(D, net, bench.rate16, 16000);
      node48k = nodeCompute(D, net, bench.rate48, 48000);
      console.log(`measure: compute in Node: ${fixed(node.msPerSecond)} ms per second of audio (${fixed(node48k.msPerSecond)} with 48 kHz in)`);
      chromiumResult = await chromiumCompute(js, modelJson, bench.rate48);
      console.log(`measure: compute in Chromium ${chromiumResult.version}: ${fixed(chromiumResult.unthrottled.msPerSecond)} ms per second, throttled 4x ${fixed(chromiumResult.throttled4x.msPerSecond)}`);
    }

    const dirty = git('status', '--porcelain', '--', ':!examples/wake-spike/results.json', ':!examples/wake-spike/README.md') !== '';
    const hours = bible.minutes / 60;
    const results = {
      date: new Date().toISOString().slice(0, 10),
      commit: git('rev-parse', 'HEAD'),
      uncommittedChanges: dirty,
      note: 'Written by scripts/measure.mjs, headless on the laptop. The bar is the Governor\'s (question 6, mw-6ww.165). Battery is not measured headless.',
      model: { trained: modelJson.trained.date, trainedCommit: modelJson.trained.commit, rule: net.rule, parameters: net.parameters, ...modelBytes() },
      bar: BAR,
      bible: {
        minutes: bible.minutes,
        files: bible.files,
        falseWakes: bible.wakes.length,
        falseWakesPerHour: bible.wakes.length / hours,
        wakes: bible.wakes.map((w) => ({ atSeconds: Math.round(w.at * 10) / 10, secondsIntoFile: Math.round(w.inFile * 10) / 10, score: Math.round(w.score * 1000) / 1000, file: w.file })),
        throughTheCar: Object.fromEntries(
          Object.entries(handsfree).map(([link, h]) => [
            link === 'nb' ? 'narrowband' : 'wideband',
            {
              minutes: h.minutes,
              falseWakes: h.wakes.length,
              falseWakesPerHour: h.wakes.length / (h.minutes / 60),
              wakes: h.wakes.map((w) => ({ atSeconds: Math.round(w.at * 10) / 10, secondsIntoFile: Math.round(w.inFile * 10) / 10, score: Math.round(w.score * 1000) / 1000, file: w.file })),
            },
          ]),
        ),
        throughTheCarNote: 'The same chapters as the soak above with nobody talking: each is the Bible leaking from the car\'s speakers to its microphone, with road (brown) noise 10, 5 and 0 dB under it in three of every four minutes, through the car\'s noise suppressor and gain and a narrowband (8 kHz, 300-3400 Hz, CVSD) or wideband (16 kHz, mSBC) link. scripts/wake-probe/handsfree.mjs.',
      },
      tries: {
        sets,
        heard: delays.length,
        delayMedianMs: Math.round(median(delays)),
        delayWorstMs: delays.length ? Math.max(...delays) : null,
      },
      compute: {
        unit: 'milliseconds of compute per second of audio',
        node,
        node48k,
        nodeSoak: { msPerSecond: bible.stats.msPerSecond, audioSeconds: bible.stats.audioSeconds },
        chromium: chromiumResult,
        note: `Wall time around the push loop, after ${WARMUP_SECONDS} s of warm-up, on ${BENCH_SECONDS} s of Bible speech, in chunks of ${CHUNK} samples. Chromium runs the detector on the page's main thread; throttling is CDP Emulation.setCPUThrottlingRate 4.`,
      },
      battery: 'not measured: needs a phone',
    };
    results.table = tableRows(results);
    results.bar.met = results.table.filter((r) => r.met !== '-').every((r) => r.met === 'met');
    if (out !== '-') writeFileSync(out, JSON.stringify(results, null, 2) + '\n');
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(printTable(results.table, false));
    if (markdown) console.log('\n' + printTable(results.table, true));
    console.log(`measure: wrote ${out}; ${BAR.label} is ${results.bar.met ? 'MET' : 'NOT MET'}; the run took ${Math.floor(seconds / 60)} min ${seconds % 60} s`);
    return results;
  } finally {
    cleanup();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const flag = (name) => {
    const at = process.argv.indexOf(name);
    return at >= 0 ? process.argv[at + 1] : undefined;
  };
  measure({ markdown: process.argv.includes('--markdown'), quick: process.argv.includes('--quick'), modelFile: flag('--model'), out: flag('--out') }).then(
    () => process.exit(0),
    (err) => {
      console.error(`measure: ${err.stack ?? err.message}`);
      process.exit(2);
    },
  );
}
