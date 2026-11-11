// The wake-word probe of route (d) in docs/wake-word-engines.md: a small classifier trained from scratch on our own
// espeak-ng sayings of 'Hey Lampas', over a plain log-mel front end written here, with negatives from espeak-ng
// sayings of other words and from LibriSpeech (CC BY 4.0). No npm dependency and no model file of anyone else's:
// it needs only espeak-ng and ffmpeg on the PATH (or ESPEAK_NG and FFMPEG), and keeps every file it makes in a
// scratch folder outside the repo. See scripts/wake-probe/README.md for how to run it.
//
//   node scripts/wake-probe/probe.mjs all   [--scratch DIR] [--librispeech DIR]
//   node scripts/wake-probe/probe.mjs prepare | train | test   (the same options)
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- the front end: 16 kHz audio to log-mel frames (25 ms Hann window, 10 ms step, 40 bands, 60-7600 Hz) ----

export const RATE = 16000;
const WIN = 400;
const HOP = 160;
const NFFT = 512;
const BANDS = 40;
const FMIN = 60;
const FMAX = 7600;
const FLOOR = 1e-10;

/** Frames logMel makes from n samples: one per 10 ms once the first 25 ms are in. */
export function frameCount(n) {
  return n < WIN ? 0 : 1 + Math.floor((n - WIN) / HOP);
}

const hzToMel = (hz) => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel) => 700 * (10 ** (mel / 2595) - 1);

function makeFilterbank() {
  const edges = [];
  for (let i = 0; i < BANDS + 2; i++) edges.push(melToHz(hzToMel(FMIN) + ((hzToMel(FMAX) - hzToMel(FMIN)) * i) / (BANDS + 1)));
  const bins = NFFT / 2 + 1;
  const weights = [];
  for (let b = 0; b < BANDS; b++) {
    const row = new Float32Array(bins);
    for (let k = 0; k < bins; k++) {
      const hz = (k * RATE) / NFFT;
      const up = (hz - edges[b]) / (edges[b + 1] - edges[b]);
      const down = (edges[b + 2] - hz) / (edges[b + 2] - edges[b + 1]);
      row[k] = Math.max(0, Math.min(up, down));
    }
    weights.push(row);
  }
  return { weights, centres: edges.slice(1, -1).map((hz) => Math.round(hz)) };
}

const FILTERS = makeFilterbank();
const HANN = Float32Array.from({ length: WIN }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1)));

/** In-place radix-2 FFT of re/im (length a power of two). */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

/** Log-mel frames of 16 kHz samples in [-1, 1]: { frames, bands, data (frame-major), centres (Hz) }. */
export function logMel(samples) {
  const frames = frameCount(samples.length);
  const data = new Float32Array(frames * BANDS);
  const re = new Float64Array(NFFT);
  const im = new Float64Array(NFFT);
  const power = new Float64Array(NFFT / 2 + 1);
  for (let f = 0; f < frames; f++) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < WIN; i++) re[i] = samples[f * HOP + i] * HANN[i];
    fft(re, im);
    for (let k = 0; k < power.length; k++) power[k] = re[k] * re[k] + im[k] * im[k];
    for (let b = 0; b < BANDS; b++) {
      const w = FILTERS.weights[b];
      let sum = 0;
      for (let k = 0; k < power.length; k++) if (w[k] !== 0) sum += w[k] * power[k];
      data[f * BANDS + b] = Math.log(sum + FLOOR);
    }
  }
  return { frames, bands: BANDS, data, centres: FILTERS.centres };
}

/** Windows of `length` frames every `hop` frames; a clip shorter than one window is padded with its quietest value. */
export function windowsOf(mel, length, hop) {
  const { frames, bands, data } = mel;
  if (frames < length) {
    const out = new Float32Array(length * bands).fill(data.length ? Math.min(...data) : Math.log(FLOOR));
    out.set(data);
    return [out];
  }
  const out = [];
  for (let s = 0; s + length <= frames; s += hop) out.push(data.slice(s * bands, (s + length) * bands));
  return out;
}

// ---- the classifier: one window of log-mel frames, pooled by two in time, to the chance it holds the phrase ----

export const WINDOW = 180; // frames: 1.8 s, room for the slowest saying (1.67 s)
const POOL = 2;
const STEP = 5; // frames between windows when listening: 50 ms
export const THRESHOLD = 0.5;

/** The classifier's input for one window: time pooled by two, the window's mean taken off, scaled down. */
export function featurize(window, bands = BANDS) {
  const frames = window.length / bands;
  const out = new Float32Array((frames / POOL) * bands);
  for (let f = 0; f < frames / POOL; f++) {
    for (let b = 0; b < bands; b++) {
      let sum = 0;
      for (let p = 0; p < POOL; p++) sum += window[(f * POOL + p) * bands + b];
      out[f * bands + b] = sum / POOL;
    }
  }
  let mean = 0;
  for (const v of out) mean += v;
  mean /= out.length;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mean) / 5;
  return out;
}

/** A seeded random source in [0, 1) (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A one-hidden-layer network (ReLU, then a sigmoid), its weights drawn from the seed. */
export function createMlp(inputs, hidden, seed) {
  const random = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
  const w1 = Float32Array.from({ length: hidden * inputs }, () => gauss() * Math.sqrt(2 / inputs));
  const w2 = Float32Array.from({ length: hidden }, () => gauss() * Math.sqrt(1 / hidden));
  return { inputs, hidden, w1, b1: new Float32Array(hidden), w2, b2: new Float32Array(1) };
}

function hiddenOf(net, x, h) {
  for (let j = 0; j < net.hidden; j++) {
    let s = net.b1[j];
    const row = j * net.inputs;
    for (let i = 0; i < net.inputs; i++) s += net.w1[row + i] * x[i];
    h[j] = s > 0 ? s : 0;
  }
  let z = net.b2[0];
  for (let j = 0; j < net.hidden; j++) z += net.w2[j] * h[j];
  return 1 / (1 + Math.exp(-z));
}

/** The network's chance that input x holds the phrase. */
export function forward(net, x) {
  return hiddenOf(net, x, new Float32Array(net.hidden));
}

/** Heard when two windows in a row reach the threshold; `at` is the second of them, or -1. */
export function detect(scores, threshold = THRESHOLD) {
  let best = 0;
  let at = -1;
  scores.forEach((s, i) => {
    best = Math.max(best, s);
    if (at < 0 && i > 0 && s >= threshold && scores[i - 1] >= threshold) at = i;
  });
  return { heard: at >= 0, best, at };
}

/** Scores of every window of a clip, one per STEP frames. */
export function scoreClip(net, samples) {
  return windowsOf(logMel(samples), WINDOW, STEP).map((w) => forward(net, featurize(w)));
}

// ---- audio in and out, through espeak-ng and ffmpeg (no npm dependency) ----

const ESPEAK = process.env.ESPEAK_NG || 'espeak-ng';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFMPEG_OUT = ['-ar', String(RATE), '-ac', '1', '-f', 's16le', 'pipe:1'];

function collect(child, label) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let err = '';
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${label} exited ${code}: ${err.trim()}`))));
  });
}

function int16ToFloat(buf) {
  const out = new Float32Array(buf.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}

/** Any audio file decoded to 16 kHz mono floats. */
export async function decode(path) {
  const ff = spawn(FFMPEG, ['-v', 'error', '-i', path, ...FFMPEG_OUT]);
  return int16ToFloat(await collect(ff, `ffmpeg ${path}`));
}

/** espeak-ng saying `text` in `voice` at `speed` words a minute and `pitch` (0-99), as 16 kHz mono floats. */
export async function say(text, voice, speed, pitch) {
  const es = spawn(ESPEAK, ['-v', voice, '-s', String(speed), '-p', String(pitch), '--stdout', text]);
  const ff = spawn(FFMPEG, ['-v', 'error', '-i', 'pipe:0', ...FFMPEG_OUT]);
  es.stdout.pipe(ff.stdin);
  es.on('error', (e) => ff.stdin.destroy(e));
  return int16ToFloat(await collect(ff, `espeak-ng -v ${voice}`));
}

/** The clip with its leading and trailing quiet cut, keeping 50 ms either side. */
function trim(clip) {
  let peak = 0;
  for (const v of clip) peak = Math.max(peak, Math.abs(v));
  const gate = peak * 0.02;
  let s = 0;
  let e = clip.length - 1;
  while (s < e && Math.abs(clip[s]) < gate) s++;
  while (e > s && Math.abs(clip[e]) < gate) e--;
  const pad = RATE * 0.05;
  return clip.slice(Math.max(0, s - pad), Math.min(clip.length, e + pad));
}

// ---- the training set: who says what ----

const PHRASES = ['Hey Lampas', 'Hey, Lampas', 'Hey Lampas.'];
const TRAIN_VOICES = ['en-gb', 'en-us', 'en-gb-scotland', 'en-gb-x-gbclan', 'en-gb-x-rp', 'en-gb-x-gbcwmd'];
const TRAIN_VARIANTS = ['', '+m1', '+m2', '+m3', '+m5', '+m6', '+m7', '+f1', '+f2', '+f3', '+f5', '+klatt', '+klatt2', '+klatt3', '+croak', '+whisper'];
const SPEEDS = [120, 145, 170, 195];
const PITCHES = [25, 50, 75];
// Never trained on: the Caribbean voice and the f4, m4 and klatt4 variants are kept for the test.
export const TEST_SAYINGS = [
  { voice: 'en-029', speed: 160, pitch: 50 },
  { voice: 'en-029+f4', speed: 150, pitch: 60 },
  { voice: 'en-us+m4', speed: 175, pitch: 40 },
  { voice: 'en-gb+klatt4', speed: 140, pitch: 50 },
];
// Words near the phrase, and everyday sentences. "Please read me the first chapter" (the test clip) is not here.
const CONFUSABLES = [
  'Hey', 'Hey Lamp', 'Hey lamb', 'Hey campus', 'Hey Postern', 'Hey buddy', 'Hey Lucas', 'Hey Thomas', 'Hey lampshade',
  'Hey glasses', 'Lamp pass', 'Lampas', 'Hey Las Vegas', 'Hey Lambert', 'Hey Atlas', 'Hey alarm', 'Okay, Lampas',
  'Hello', 'Play', 'Pause', 'Stop', 'Next chapter', 'Previous chapter', 'Back a verse', 'Open John three',
];
const SENTENCES = [
  'In the beginning was the Word, and the Word was with God.', 'Turn left at the next light and keep going.',
  'What time does the meeting start tomorrow?', 'I left the keys on the kitchen table.',
  'The weather is supposed to be clear all weekend.', 'Can you remind me to call my mother?',
  'He said the lamp was too bright for the room.', 'They walked along the river until it was dark.',
  'Read the second verse again, slowly.', 'The campus library opens at eight.', 'Pass the salt, please.',
  'We are almost out of gas, find a station.', 'She played the piano for an hour.', 'How far is it to the next town?',
  'Hey, how are you doing today?', 'Let me think about that for a minute.', 'The children were singing in the back seat.',
  'Put the lamp on the desk by the window.', 'A lamb was lost on the hillside.', 'Hey, look at that!',
];

const SAMPLES_PER_WINDOW = WIN + HOP * (WINDOW - 1);

function pick(random, list) {
  return list[Math.floor(random() * list.length)];
}

function rms(x) {
  let s = 0;
  for (const v of x) s += v * v;
  return Math.sqrt(s / Math.max(1, x.length));
}

/**
 * One training window: the clip (or the part of it `part` says) laid over a background of speech or quiet.
 * part: 'whole' ends in the window's last 0.3 s; 'head' keeps only its first 35-75 %; 'tail' only its last 30-55 %;
 * 'any' lays it anywhere, cut at either edge.
 */
function mixWindow(random, clip, background, part) {
  const out = new Float32Array(SAMPLES_PER_WINDOW);
  for (let i = 0; i < out.length; i++) out[i] = (random() - 0.5) * 2e-4;
  const gain = 0.2 + random() * 0.8;
  let start;
  if (part === 'whole') start = SAMPLES_PER_WINDOW - Math.floor(RATE * (0.02 + random() * 0.28)) - clip.length;
  else if (part === 'head') start = SAMPLES_PER_WINDOW - Math.floor(clip.length * (0.35 + random() * 0.4));
  else if (part === 'tail') start = -Math.floor(clip.length * (0.45 + random() * 0.25));
  else start = Math.floor(random() * (SAMPLES_PER_WINDOW + clip.length)) - clip.length;
  if (part === 'whole' && start < 0) start = 0;
  for (let i = 0; i < clip.length; i++) {
    const t = start + i;
    if (t >= 0 && t < out.length) out[t] += clip[i] * gain;
  }
  if (background && random() < 0.7) {
    const at = Math.floor(random() * (background.length - out.length));
    const seg = background.subarray(at, at + out.length);
    const snr = 5 + random() * 20;
    const scale = (gain * rms(clip)) / Math.max(1e-6, rms(seg)) / 10 ** (snr / 20);
    for (let i = 0; i < out.length; i++) out[i] += seg[i] * scale;
  }
  return out;
}

// ---- prepare, train, test ----

function options(argv) {
  const opt = { command: argv[0] ?? 'all' };
  for (let i = 1; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = argv[i + 1];
  opt.scratch ??= process.env.WAKE_PROBE_SCRATCH ?? join(homedir(), '.cache', 'voice-kit-wake-spike', 'probe');
  opt.librispeech ??= process.env.WAKE_PROBE_LIBRISPEECH ?? join(opt.scratch, 'dl', 'librispeech', 'LibriSpeech', 'dev-clean');
  return opt;
}

function saveClips(path, clips) {
  const lengths = clips.map((c) => c.length);
  const all = new Int16Array(lengths.reduce((a, b) => a + b, 0));
  let at = 0;
  for (const c of clips) for (const v of c) all[at++] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  writeFileSync(path + '.i16', Buffer.from(all.buffer));
  writeFileSync(path + '.json', JSON.stringify(lengths));
}

function loadClips(path) {
  const lengths = JSON.parse(readFileSync(path + '.json', 'utf8'));
  const buf = readFileSync(path + '.i16');
  const all = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  const out = [];
  let at = 0;
  for (const n of lengths) {
    out.push(Float32Array.from(all.subarray(at, at + n), (v) => v / 32767));
    at += n;
  }
  return out;
}

/** The LibriSpeech dev-clean speakers, split: the first 30 for training negatives, the last 10 held out. */
function librispeechFiles(root, speakers, perSpeaker) {
  if (!existsSync(root)) throw new Error(`no LibriSpeech folder at ${root}: see scripts/wake-probe/README.md`);
  const files = [];
  for (const sp of speakers) {
    const mine = [];
    for (const ch of readdirSync(join(root, sp)).sort()) {
      for (const f of readdirSync(join(root, sp, ch)).sort()) if (f.endsWith('.flac')) mine.push(join(root, sp, ch, f));
    }
    files.push(...mine.slice(0, perSpeaker));
  }
  return files;
}

async function decodeAll(files) {
  const parts = [];
  for (const f of files) parts.push(await decode(f));
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

async function prepare(opt) {
  const t0 = Date.now();
  const dir = join(opt.scratch, 'data');
  mkdirSync(dir, { recursive: true });
  const random = rng(11);
  const positives = [];
  // each part is kept once made: delete the scratch folder's data/ to make them again
  if (existsSync(join(dir, 'negatives.json'))) console.log('prepare: the sayings are already made');
  else {
    for (const voice of TRAIN_VOICES) {
      for (const variant of TRAIN_VARIANTS) {
        for (const speed of SPEEDS) {
          for (const pitch of PITCHES) positives.push(trim(await say(pick(random, PHRASES), voice + variant, speed, pitch)));
        }
      }
    }
    saveClips(join(dir, 'positives'), positives);
    console.log(`prepare: ${positives.length} sayings of the phrase (${TRAIN_VOICES.length} voices x ${TRAIN_VARIANTS.length} variants x ${SPEEDS.length} speeds x ${PITCHES.length} pitches)`);
    const negatives = [];
    for (const text of [...CONFUSABLES, ...CONFUSABLES, ...SENTENCES]) {
      for (let k = 0; k < 12; k++) negatives.push(trim(await say(text, pick(random, TRAIN_VOICES) + pick(random, TRAIN_VARIANTS), pick(random, SPEEDS), pick(random, PITCHES))));
    }
    saveClips(join(dir, 'negatives'), negatives);
    console.log(`prepare: ${negatives.length} sayings of other words and sentences`);
  }
  const speakers = readdirSync(opt.librispeech).filter((d) => /^\d+$/.test(d)).sort((a, b) => Number(a) - Number(b));
  const train = await decodeAll(librispeechFiles(opt.librispeech, speakers.slice(0, 30), 25));
  saveClips(join(dir, 'librispeech-train'), [train]);
  const held = await decodeAll(librispeechFiles(opt.librispeech, speakers.slice(-10), 20));
  saveClips(join(dir, 'librispeech-held-out'), [held]);
  console.log(`prepare: LibriSpeech dev-clean ${(train.length / RATE / 60).toFixed(1)} min from 30 speakers for training, ${(held.length / RATE / 60).toFixed(1)} min from 10 others held out`);
  console.log(`prepare: took ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

function trainNet(opt) {
  const t0 = Date.now();
  const dir = join(opt.scratch, 'data');
  const positives = loadClips(join(dir, 'positives'));
  const negatives = loadClips(join(dir, 'negatives'));
  const [background] = loadClips(join(dir, 'librispeech-train'));
  const random = rng(23);
  const feat = (samples) => featurize(logMel(samples).data);
  // fixed negatives: speech windows, other sayings anywhere in the window, quiet
  const fixed = [];
  for (let i = 0; i < 12000; i++) {
    const at = Math.floor(random() * (background.length - SAMPLES_PER_WINDOW));
    fixed.push(feat(background.slice(at, at + SAMPLES_PER_WINDOW)));
  }
  for (const clip of negatives) for (let k = 0; k < 3; k++) fixed.push(feat(mixWindow(random, clip, background, k === 0 ? 'whole' : 'any')));
  for (let i = 0; i < 300; i++) fixed.push(feat(mixWindow(random, new Float32Array(1), null, 'any')));
  console.log(`train: ${fixed.length} fixed negative windows made in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const inputs = fixed[0].length;
  const net = createMlp(inputs, 32, 5);
  const params = [net.w1, net.b1, net.w2, net.b2];
  const m = params.map((p) => new Float32Array(p.length));
  const v = params.map((p) => new Float32Array(p.length));
  const grads = params.map((p) => new Float32Array(p.length));
  const h = new Float32Array(net.hidden);
  const lr = 1e-3;
  const decay = 1e-4;
  let step = 0;
  const EPOCHS = 35;
  const MINE_AFTER = 25;
  for (let epoch = 1; epoch <= EPOCHS; epoch++) {
    if (epoch === MINE_AFTER + 1) {
      // hard negatives: every window of the training speech that the network takes for the phrase is added as a negative
      const mel = logMel(background);
      const mined = [];
      for (let s = 0; s + WINDOW <= mel.frames; s += STEP) {
        const x = featurize(mel.data.subarray(s * BANDS, (s + WINDOW) * BANDS));
        const p = forward(net, x);
        if (p >= 0.2) mined.push({ x, p });
      }
      mined.sort((a, b) => b.p - a.p);
      for (const { x } of mined.slice(0, 6000)) fixed.push(x);
      console.log(`train: ${mined.length} hard negative windows found in the training speech, ${Math.min(6000, mined.length)} added (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
    // fresh positives and part-sayings every epoch: new background, gain and place
    const set = fixed.map((x) => ({ x, y: 0, w: 1 }));
    for (const clip of positives) {
      for (let k = 0; k < 3; k++) set.push({ x: feat(mixWindow(random, clip, background, 'whole')), y: 1, w: 2 });
      set.push({ x: feat(mixWindow(random, clip, background, random() < 0.6 ? 'head' : 'tail')), y: 0, w: 1 });
    }
    for (let i = set.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [set[i], set[j]] = [set[j], set[i]];
    }
    let loss = 0;
    let right = [0, 0];
    let count = [0, 0];
    for (let b = 0; b < set.length; b += 64) {
      const batch = set.slice(b, b + 64);
      for (const g of grads) g.fill(0);
      for (const { x, y, w } of batch) {
        const p = hiddenOf(net, x, h);
        loss += -w * (y ? Math.log(p + 1e-7) : Math.log(1 - p + 1e-7));
        count[y]++;
        if ((p >= THRESHOLD ? 1 : 0) === y) right[y]++;
        const dz = w * (p - y);
        grads[3][0] += dz;
        for (let j = 0; j < net.hidden; j++) {
          grads[2][j] += dz * h[j];
          if (h[j] <= 0) continue;
          const dh = dz * net.w2[j];
          grads[1][j] += dh;
          const row = j * inputs;
          for (let i = 0; i < inputs; i++) grads[0][row + i] += dh * x[i];
        }
      }
      step++;
      for (let k = 0; k < params.length; k++) {
        const p = params[k];
        const g = grads[k];
        for (let i = 0; i < p.length; i++) {
          const gi = g[i] / batch.length + decay * p[i];
          m[k][i] = 0.9 * m[k][i] + 0.1 * gi;
          v[k][i] = 0.999 * v[k][i] + 0.001 * gi * gi;
          p[i] -= (lr * (m[k][i] / (1 - 0.9 ** step))) / (Math.sqrt(v[k][i] / (1 - 0.999 ** step)) + 1e-8);
        }
      }
    }
    console.log(`train: epoch ${epoch}/${EPOCHS} loss ${(loss / set.length).toFixed(4)} positives right ${right[1]}/${count[1]} negatives right ${right[0]}/${count[0]} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  const model = { kind: 'wake-probe-mlp', phrase: 'Hey Lampas', window: WINDOW, pool: POOL, bands: BANDS, inputs, hidden: net.hidden };
  for (const k of ['w1', 'b1', 'w2', 'b2']) model[k] = Array.from(net[k]);
  writeFileSync(join(opt.scratch, 'model.json'), JSON.stringify(model));
  console.log(`train: ${inputs * net.hidden + 2 * net.hidden + 1} weights (${(inputs * net.hidden + 2 * net.hidden + 1) * 4} bytes as float32) written to the scratch folder's model.json; took ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

function loadNet(opt) {
  const path = join(opt.scratch, 'model.json');
  if (!existsSync(path)) throw new Error(`no model at ${path}: run the train command first`);
  const model = JSON.parse(readFileSync(path, 'utf8'));
  const net = { inputs: model.inputs, hidden: model.hidden };
  for (const k of ['w1', 'b1', 'w2', 'b2']) net[k] = Float32Array.from(model[k]);
  return net;
}

function padded(clip) {
  const out = new Float32Array(clip.length + RATE * 2);
  out.set(clip, RATE);
  return out;
}

async function testNet(opt) {
  const net = loadNet(opt);
  let ok = true;
  const report = (name, expect, clip) => {
    const t0 = performance.now();
    const scores = scoreClip(net, padded(clip));
    const ms = performance.now() - t0;
    const r = detect(scores);
    const pass = r.heard === expect;
    ok &&= pass;
    const seconds = clip.length / RATE;
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: ${r.heard ? 'HEARD' : 'not heard'} (expected ${expect ? 'heard' : 'not heard'}; best score ${r.best.toFixed(3)}, ${seconds.toFixed(2)} s of audio scored in ${ms.toFixed(0)} ms)`);
  };
  for (const s of TEST_SAYINGS) report(`espeak-ng -v ${s.voice} -s ${s.speed} -p ${s.pitch} "Hey Lampas"`, true, await say('Hey Lampas', s.voice, s.speed, s.pitch));
  const english = fileURLToPath(new URL('../../packages/testing/clips/english.wav', import.meta.url));
  report('packages/testing/clips/english.wav ("Please read me the first chapter")', false, await decode(english));
  for (const extra of (opt.clips ?? '').split(',').filter(Boolean)) report(extra, false, await decode(extra));
  const heldPath = join(opt.scratch, 'data', 'librispeech-held-out');
  if (existsSync(heldPath + '.json')) {
    const [held] = loadClips(heldPath);
    const scores = scoreClip(net, held);
    let wakes = 0;
    let quietUntil = -1;
    for (let i = 1; i < scores.length; i++) {
      if (i > quietUntil && scores[i] >= THRESHOLD && scores[i - 1] >= THRESHOLD) {
        wakes++;
        quietUntil = i + RATE / HOP / STEP; // one second before another wake counts
      }
    }
    console.log(`info: ${wakes} false wake(s) in ${(held.length / RATE / 60).toFixed(1)} min of held-out LibriSpeech speech (10 speakers never trained on); not part of the pass`);
  }
  console.log(ok ? 'probe: PASS' : 'probe: FAIL');
  return ok;
}

async function main(argv) {
  const opt = options(argv);
  if (['prepare', 'all'].includes(opt.command)) await prepare(opt);
  if (['train', 'all'].includes(opt.command)) trainNet(opt);
  if (['test', 'all'].includes(opt.command)) return testNet(opt);
  if (!['prepare', 'train'].includes(opt.command)) throw new Error(`unknown command ${opt.command}: use all, prepare, train or test`);
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (ok) => process.exit(ok ? 0 : 1),
    (e) => {
      console.error(e.message);
      process.exit(2);
    },
  );
}
