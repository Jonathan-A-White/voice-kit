// The wake-word probe of route (d) in docs/wake-word-engines.md: makes the training, threshold and measuring audio,
// trains our own small 'Hey Lampas' network, sets its threshold on audio kept apart, and measures the committed model
// on other audio again. All scoring goes through ./detector.mjs. It needs espeak-ng and ffmpeg on the PATH (or
// ESPEAK_NG and FFMPEG), and, for prepare and train, the scratch folder's Python venv (README.md says how). It keeps
// every file it makes in the scratch folder, outside the repo; only the model and its licences are committed.
//
//   node scripts/wake-probe/probe.mjs prepare     make the sayings, mix and featurize the training audio
//   node scripts/wake-probe/probe.mjs train       train the network (PyTorch, through train.py)
//   node scripts/wake-probe/probe.mjs calibrate   set the threshold on the threshold set; writes the committed model
//   node scripts/wake-probe/probe.mjs measure     measure the committed model on the measuring set [--markdown]
//   (options: --root DIR, the scratch root, default ~/.cache/voice-kit-wake-spike)
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as D from './detector.mjs';

const RATE = D.FRONT_END.rate;
const WINDOW = 80; // network frames in one window: 1.6 s (train.py's WINDOW)
const WINDOW_SAMPLES = D.windowSamples(WINDOW);
const REPO = fileURLToPath(new URL('../../', import.meta.url));
export const MODEL_PATH = join(REPO, 'examples/wake-spike/public/models/hey-lampas.json');
const FIXTURE_PATH = join(REPO, 'scripts/wake-probe/fixtures/hey-lampas.wav');
const VITS_MODEL = 'tts_models--en--vctk--vits'; // Coqui's VITS voice trained on VCTK: 109 speakers

// The Governor's bar (mw-6ww.165, question 6): at most 1 false wake an hour while speech plays, at most 2 misses in 20.
export const BAR = { falseWakesPerHour: 1, missesIn20: 2, measuringMinutes: 60 };
// The threshold is the lowest that keeps false wakes on the threshold speech at or under this, chosen before training.
const CALIBRATION_TARGET = 0.5;

// ---- who says what: three sets kept apart by speaker and voice ----

const PHRASES = ['Hey Lampas', 'Hey, Lampas', 'Hey Lampas.', 'Hey Lampas!', 'hey lampas'];
// espeak-ng: training voices and variants; the threshold set has en-us-nyc and four other variants; the measuring set
// has en-029 and the m4, f4 and klatt4 variants. No (voice, variant) pair is in two sets.
const ES_TRAIN_VOICES = ['en-gb', 'en-us', 'en-gb-scotland', 'en-gb-x-gbclan', 'en-gb-x-rp', 'en-gb-x-gbcwmd'];
const ES_TRAIN_VARIANTS = ['', '+m1', '+m2', '+m3', '+m5', '+m6', '+m7', '+f1', '+f2', '+f3', '+f5', '+klatt', '+klatt2', '+klatt3', '+croak', '+whisper'];
const ES_THRESHOLD = { voices: ['en-us-nyc'], variants: ['+m8', '+klatt5', '+Andy', '+Annie'] };
const ES_MEASURE = { voices: ['en-029'], variants: ['+m4', '+f4', '+klatt4'] };
const SPEEDS = [120, 145, 170, 195];
const PITCHES = [25, 50, 75];
// Near words and everyday sentences: negatives. "Please read me the first chapter" (the test clip) is not here, and
// nothing that sounds the same as the phrase ("Hey lamp us") is.
const CONFUSABLES = [
  'Hey', 'Hey Lamp', 'Hey lamb', 'Hey campus', 'Hey Postern', 'Hey buddy', 'Hey Lucas', 'Hey Thomas', 'Hey lampshade',
  'Hey glasses', 'Lampas', 'Hey Las Vegas', 'Hey Lambert', 'Hey Atlas', 'Hey alarm', 'Okay, Lampas', 'Hello',
  'Play', 'Pause', 'Stop', 'Next chapter', 'Previous chapter', 'Back a verse', 'Open John three', 'Hey Linda',
  'Hey llama', 'Hey Lana', 'Hey Pampas', 'Hey Tampa', 'Hey canvas', 'Hey lemon', 'Hey, let us pass', 'Hey Alexa',
  'Hey Google', 'Hey Siri', 'Hey Lambo', 'Hey Lamar', 'Hey lamplight', 'Hey compass', 'Hey Douglas', 'Hey palace',
  'Hey Nicholas', 'Hey Marcus', 'A lamp post', 'The lamp is on', 'Hey, pass the lamp', 'Hey there', 'Hey you',
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

// ---- small tools ----

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

const pick = (random, list) => list[Math.floor(random() * list.length)];
const between = (random, lo, hi) => lo + random() * (hi - lo);

function shuffled(random, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function rms(x, from = 0, to = x.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

/** Adds `noise` (from `at`) into `out` from `start`, scaled so the signal's level over it is `snr` dB. */
function addAt(out, noise, scale, start = 0) {
  for (let i = 0; i < noise.length && start + i < out.length; i++) if (start + i >= 0) out[start + i] += noise[i] * scale;
}

/** Road-like noise: a low rumble, tyre hiss and an engine's hum that drifts, slowly swelling; rms 1. */
export function roadNoise(random, n) {
  const out = new Float32Array(n);
  let brown = 0;
  let lp = 0;
  let hp = 0;
  let prev = 0;
  const rumble = between(random, 0.5, 1.5);
  const hiss = between(random, 0.05, 0.6);
  const hum = between(random, 0, 0.5);
  let f0 = between(random, 25, 70);
  let phase = 0;
  const swell = between(random, 0.05, 0.3);
  const depth = between(random, 0, 0.4);
  const swellPhase = random() * 2 * Math.PI;
  for (let i = 0; i < n; i++) {
    const w = random() * 2 - 1;
    brown = 0.997 * brown + w * 0.05;
    lp += 0.25 * (w - lp); // a soft low-pass of white noise
    hp = 0.95 * (hp + lp - prev); // then a high-pass: the hiss band
    prev = lp;
    f0 += (random() - 0.5) * 0.01;
    phase += (2 * Math.PI * f0) / RATE;
    const engine = Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase);
    const am = 1 + depth * Math.sin((2 * Math.PI * swell * i) / RATE + swellPhase);
    out[i] = am * (rumble * brown + hiss * hp + hum * engine * 0.1);
  }
  const level = rms(out);
  for (let i = 0; i < n; i++) out[i] /= level || 1;
  return out;
}

/** A room's echo (a small Schroeder reverberator: four combs and two all-passes), its level kept; 0.3 s of tail. */
export function reverb(random, x) {
  const rt60 = between(random, 0.2, 0.8);
  const wet = between(random, 0.2, 0.7);
  const damp = between(random, 0.1, 0.5);
  const tail = Math.floor(RATE * 0.3);
  const out = new Float32Array(x.length + tail);
  const combs = [405, 431, 463, 492].map((d) => Math.round(d * between(random, 0.8, 1.25)));
  const acc = new Float32Array(out.length);
  for (const d of combs) {
    const g = 10 ** ((-3 * d) / (rt60 * RATE));
    const buf = new Float32Array(d);
    let filt = 0;
    for (let i = 0; i < out.length; i++) {
      const y = buf[i % d];
      filt = y * (1 - damp) + filt * damp;
      buf[i % d] = (i < x.length ? x[i] : 0) + filt * g;
      acc[i] += y;
    }
  }
  for (const d of [202, 160]) {
    const buf = new Float32Array(d);
    for (let i = 0; i < out.length; i++) {
      const y = buf[i % d];
      const v = acc[i] + y * 0.5;
      buf[i % d] = v;
      acc[i] = y - v * 0.5;
    }
  }
  const dryLevel = rms(x);
  const wetLevel = rms(acc) || 1;
  for (let i = 0; i < out.length; i++) out[i] = (i < x.length ? x[i] * (1 - wet) : 0) + (acc[i] / wetLevel) * dryLevel * wet;
  const level = rms(out) || 1;
  for (let i = 0; i < out.length; i++) out[i] *= dryLevel / level;
  return out;
}

/** The clip with its leading and trailing quiet cut, keeping 50 ms either side. */
export function trim(clip) {
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
const PAD = RATE * 0.05; // the trimmed clip's quiet after its last sound

// ---- audio in and out, through espeak-ng, ffmpeg and the venv's Python ----

const ESPEAK = process.env.ESPEAK_NG || 'espeak-ng';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const TO_16K = ['-ar', String(RATE), '-ac', '1', '-f', 's16le', 'pipe:1'];

function collect(child, label) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let err = '';
    child.stdout.on('data', (c) => chunks.push(c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`${label} exited ${code}: ${err.trim().slice(0, 400)}`))));
  });
}

function int16ToFloat(buf) {
  const out = new Float32Array(buf.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}

/** Audio files decoded, one after another, to 16 kHz mono floats (one ffmpeg, through its concat list). */
export async function decodeFiles(files, scratch) {
  const list = join(scratch, 'concat.txt');
  writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  const ff = spawn(FFMPEG, ['-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, ...TO_16K]);
  return int16ToFloat(await collect(ff, `ffmpeg (${files.length} files)`));
}

/** Any audio file decoded to 16 kHz mono floats. */
export async function decode(path) {
  return int16ToFloat(await collect(spawn(FFMPEG, ['-v', 'error', '-i', path, ...TO_16K]), `ffmpeg ${path}`));
}

/** espeak-ng saying `text` in `voice` at `speed` words a minute and `pitch` (0-99), trimmed, at 16 kHz. */
export async function say(text, voice, speed, pitch) {
  const es = spawn(ESPEAK, ['-v', voice, '-s', String(speed), '-p', String(pitch), '--stdout', text]);
  const ff = spawn(FFMPEG, ['-v', 'error', '-i', 'pipe:0', ...TO_16K]);
  es.stdout.pipe(ff.stdin);
  es.on('error', (e) => ff.stdin.destroy(e));
  return trim(int16ToFloat(await collect(ff, `espeak-ng -v ${voice}`)));
}

function run(command, args, label) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, OMP_NUM_THREADS: '4', MKL_NUM_THREADS: '4', OPENBLAS_NUM_THREADS: '4' };
    const child = spawn('nice', ['-n', '10', command, ...args], { stdio: 'inherit', env });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${label} exited ${code}`))));
  });
}

/** VCTK VITS sayings of jobs [{ text, speaker, length, noise, noisew }], trimmed, at 16 kHz (resampled by ffmpeg). */
async function vitsSay(opt, jobs, name) {
  const base = join(opt.scratch, 'vits', name);
  mkdirSync(join(opt.scratch, 'vits'), { recursive: true });
  writeFileSync(base + '.jobs.json', JSON.stringify(jobs));
  await run(opt.python, ['-I', join(REPO, 'scripts/wake-probe/vits_say.py'), opt.vitsModel, base + '.jobs.json', base], `vits ${name}`);
  const { rate, gap, lengths } = JSON.parse(readFileSync(base + '.json', 'utf8'));
  const ff = spawn(FFMPEG, ['-v', 'error', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', base + '.i16', ...TO_16K]);
  const all = int16ToFloat(await collect(ff, 'ffmpeg resample'));
  const clips = [];
  let at = 0;
  for (const n of lengths) {
    const from = Math.round((at * RATE) / rate);
    const to = Math.round(((at + n) * RATE) / rate);
    clips.push(trim(all.slice(from, Math.min(to, all.length))));
    at += n + gap;
  }
  return clips;
}

// ---- clips on disk ----

function saveClips(path, clips, meta = []) {
  const lengths = clips.map((c) => c.length);
  const all = new Int16Array(lengths.reduce((a, b) => a + b, 0));
  let at = 0;
  for (const c of clips) for (const v of c) all[at++] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  writeFileSync(path + '.i16', Buffer.from(all.buffer));
  writeFileSync(path + '.json', JSON.stringify({ lengths, meta }));
}

function loadClips(path) {
  const { lengths, meta } = JSON.parse(readFileSync(path + '.json', 'utf8'));
  const buf = readFileSync(path + '.i16');
  const all = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
  const clips = [];
  let at = 0;
  for (const n of lengths) {
    clips.push(Float32Array.from(all.subarray(at, at + n), (v) => v / 32767));
    at += n;
  }
  return { clips, meta };
}

function writeWav(path, samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), i * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([head, data]));
}

// ---- options and the sets ----

function options(argv) {
  const opt = { command: argv[0] ?? 'help' };
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opt[key] = argv[++i];
    else opt[key] = true;
  }
  opt.root ??= process.env.WAKE_PROBE_ROOT ?? join(homedir(), '.cache', 'voice-kit-wake-spike');
  opt.scratch = join(opt.root, 'route-d');
  opt.librispeech = join(opt.root, 'dl', 'librispeech', 'LibriSpeech');
  opt.vitsModel = join(opt.root, 'dl', 'coqui', VITS_MODEL);
  opt.python = process.env.WAKE_PROBE_PYTHON ?? join(opt.root, 'venv', 'bin', 'python');
  opt.minutesPerSpeaker = Number(opt['minutes-per-speaker'] ?? 12);
  return opt;
}

function speakersOf(opt, subset) {
  const root = join(opt.librispeech, subset);
  if (!existsSync(root)) throw new Error(`no LibriSpeech ${subset} at ${root}: see scripts/wake-probe/README.md`);
  return readdirSync(root).filter((d) => /^\d+$/.test(d)).sort((a, b) => Number(a) - Number(b));
}

function filesOf(opt, subset, speaker) {
  const root = join(opt.librispeech, subset, speaker);
  const out = [];
  for (const ch of readdirSync(root).sort()) for (const f of readdirSync(join(root, ch)).sort()) if (f.endsWith('.flac')) out.push(join(root, ch, f));
  return out;
}

/** The VCTK speakers (p225 and on), split: measuring, threshold, the test's fixture, and the rest to train. */
function vitsSets(opt) {
  const names = Object.keys(JSON.parse(readFileSync(join(opt.vitsModel, 'speaker_ids.json'), 'utf8'))).filter((n) => /^p\d+$/.test(n)).sort();
  const order = shuffled(rng(31), names);
  return { measure: order.slice(0, 21), threshold: order.slice(21, 41), fixture: order.slice(41, 42), train: order.slice(42).sort() };
}

function esCombos(set) {
  const out = [];
  for (const voice of ES_TRAIN_VOICES) for (const variant of set.variants) out.push(voice + variant);
  for (const voice of set.voices) for (const variant of ['', ...ES_TRAIN_VARIANTS, ...set.variants]) out.push(voice + variant);
  return out;
}

function vitsJob(random, text, speaker) {
  return { text, speaker, length: between(random, 0.8, 1.3), noise: between(random, 0.4, 0.8), noisew: between(random, 0.5, 1.0) };
}

/** The held-out sayings of one set: VCTK speakers (`each` sayings apiece) and espeak-ng voices, interleaved so each 20 has both. */
async function heldOutSayings(opt, name, vitsSpeakers, each, esSet, esCount, seed) {
  const path = join(opt.scratch, 'sayings', name);
  if (existsSync(path + '.json')) return;
  const random = rng(seed);
  const speakerOf = vitsSpeakers.flatMap((s) => Array(each).fill(s));
  const vits = await vitsSay(opt, speakerOf.map((s) => vitsJob(random, pick(random, PHRASES), s)), name);
  const combos = shuffled(random, esCombos(esSet)).slice(0, esCount);
  const es = [];
  for (const v of combos) es.push(await say(pick(random, PHRASES), v, pick(random, SPEEDS), pick(random, PITCHES)));
  const clips = [];
  const meta = [];
  const perSet = Math.round((20 * vits.length) / (vits.length + es.length));
  for (let p = 0, e = 0; p < vits.length || e < es.length; ) {
    for (let k = 0; k < perSet && p < vits.length; k++, p++) {
      clips.push(vits[p]);
      meta.push(`VCTK VITS ${speakerOf[p]}`);
    }
    for (let k = 0; k < 20 - perSet && e < es.length; k++, e++) {
      clips.push(es[e]);
      meta.push(`espeak-ng ${combos[e]}`);
    }
  }
  saveClips(path, clips, meta);
  console.log(`prepare: ${clips.length} ${name} sayings (${vits.length} by ${vitsSpeakers.length} VCTK VITS speakers, ${es.length} by espeak-ng voices)`);
}

// ---- prepare ----

async function prepareSayings(opt, sets) {
  const dir = join(opt.scratch, 'sayings');
  mkdirSync(dir, { recursive: true });
  const random = rng(11);
  if (!existsSync(join(dir, 'pos-espeak.json'))) {
    const clips = [];
    for (const voice of ES_TRAIN_VOICES) for (const variant of ES_TRAIN_VARIANTS) for (const speed of SPEEDS) for (const pitch of PITCHES) clips.push(await say(pick(random, PHRASES), voice + variant, speed, pitch));
    saveClips(join(dir, 'pos-espeak'), clips);
    const neg = [];
    for (const text of [...CONFUSABLES, ...CONFUSABLES, ...SENTENCES]) {
      for (let k = 0; k < 8; k++) neg.push(await say(text, pick(random, ES_TRAIN_VOICES) + pick(random, ES_TRAIN_VARIANTS), pick(random, SPEEDS), pick(random, PITCHES)));
    }
    saveClips(join(dir, 'neg-espeak'), neg);
    console.log(`prepare: espeak-ng: ${clips.length} sayings of the phrase, ${neg.length} of other words and sentences`);
  }
  if (!existsSync(join(dir, 'pos-vits.json'))) {
    const jobs = [];
    for (const s of sets.train) for (let k = 0; k < 30; k++) jobs.push(vitsJob(random, pick(random, PHRASES), s));
    saveClips(join(dir, 'pos-vits'), await vitsSay(opt, jobs, 'pos-vits'));
    const neg = [];
    for (const text of CONFUSABLES) for (let k = 0; k < 20; k++) neg.push(vitsJob(random, text, pick(random, sets.train)));
    for (const text of SENTENCES) for (let k = 0; k < 10; k++) neg.push(vitsJob(random, text, pick(random, sets.train)));
    saveClips(join(dir, 'neg-vits'), await vitsSay(opt, neg, 'neg-vits'));
    console.log(`prepare: VCTK VITS: ${jobs.length} sayings of the phrase by ${sets.train.length} speakers, ${neg.length} of other words and sentences`);
  }
  await heldOutSayings(opt, 'threshold', sets.threshold, 3, ES_THRESHOLD, 20, 41);
  await heldOutSayings(opt, 'measure', sets.measure, 2, ES_MEASURE, 18, 43);
  if (!existsSync(FIXTURE_PATH)) {
    const [clip] = await vitsSay(opt, [{ text: 'Hey Lampas', speaker: sets.fixture[0], length: 1, noise: 0.667, noisew: 0.8 }], 'fixture');
    mkdirSync(join(REPO, 'scripts/wake-probe/fixtures'), { recursive: true });
    writeWav(FIXTURE_PATH, clip.map((v) => v * 0.5));
    console.log(`prepare: the test's fixture, VCTK VITS speaker ${sets.fixture[0]}, written to scripts/wake-probe/fixtures/hey-lampas.wav`);
  }
}

/** One of four conditions for a stretch of audio: as it is, in a room, under road noise, or both. */
function roughen(random, x, background) {
  const r = random();
  let out = x;
  if (r >= 0.4 && r < 0.6) out = reverb(random, x).subarray(0, x.length);
  if (r >= 0.85) out = reverb(random, x).subarray(0, x.length);
  if (r >= 0.6) {
    out = Float32Array.from(out);
    const noise = roadNoise(random, out.length);
    addAt(out, noise, (rms(out) || 1e-3) / 10 ** (between(random, 0, 20) / 20));
  }
  if (background) {
    out = Float32Array.from(out);
    addAt(out, background.noise, background.scale);
  }
  return out;
}

/** The negative stream: train-clean-100 speech roughened in 20 s stretches, then road noise alone and near-quiet. */
async function prepareStream(opt) {
  const feat = join(opt.scratch, 'feat');
  mkdirSync(feat, { recursive: true });
  const streamPath = join(feat, 'stream.f32');
  const poolPath = join(opt.scratch, 'sayings', 'speech-pool');
  if (existsSync(join(feat, 'stream.json'))) return JSON.parse(readFileSync(join(feat, 'stream.json'), 'utf8'));
  const t0 = Date.now();
  const random = rng(17);
  const fd = openSync(streamPath, 'w');
  let frames = 0;
  const write = (x) => {
    const f = D.features(x);
    writeSync(fd, Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength));
    frames += f.frames;
  };
  const pool = [];
  const speakers = speakersOf(opt, 'train-clean-100');
  let seconds = 0;
  for (const [n, sp] of speakers.entries()) {
    const files = filesOf(opt, 'train-clean-100', sp);
    const wanted = opt.minutesPerSpeaker * 60 * RATE;
    const chosen = [];
    let estimate = 0;
    for (const f of files) {
      if (estimate >= wanted) break;
      chosen.push(f);
      estimate += statSync(f).size * 0.8; // samples: flac keeps about 55-60 % of 16-bit audio, so take a little more and cut
    }
    const audio = await decodeFiles(chosen, opt.scratch);
    const take = audio.subarray(0, Math.min(audio.length, wanted));
    seconds += take.length / RATE;
    // 20 s from each speaker's audio go to the pool behind the positives, the rest to the stream
    const poolAt = Math.floor(random() * Math.max(1, take.length - 20 * RATE));
    pool.push(take.slice(poolAt, poolAt + 20 * RATE));
    for (let at = 0; at < take.length; at += 20 * RATE) write(roughen(random, take.subarray(at, Math.min(take.length, at + 20 * RATE)), null));
    if ((n + 1) % 25 === 0) console.log(`prepare: stream: ${n + 1}/${speakers.length} speakers, ${(seconds / 3600).toFixed(1)} h (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  for (let k = 0; k < 60; k++) {
    const noise = roadNoise(random, 20 * RATE);
    const level = 10 ** (between(random, -50, -10) / 20);
    write(noise.map((v) => v * level));
  }
  for (let k = 0; k < 15; k++) write(Float32Array.from({ length: 20 * RATE }, () => (random() - 0.5) * 10 ** (between(random, -90, -50) / 20)));
  closeSync(fd);
  saveClips(poolPath, pool);
  const info = { frames, speechHours: seconds / 3600, speakers: speakers.length, noiseMinutes: 20, quietMinutes: 5 };
  writeFileSync(join(feat, 'stream.json'), JSON.stringify(info));
  console.log(`prepare: stream: ${(seconds / 3600).toFixed(1)} h of speech from ${speakers.length} speakers, 20 min of road noise, 5 min of near-quiet; ${frames} frames (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  return info;
}

/**
 * One training window (WINDOW_SAMPLES long): the clip laid so its last sound ends `end` seconds before the window's
 * end, roughened, over a background of pool speech, road noise or near-quiet. A head keeps only the clip's first part.
 */
export function trainingWindow(random, clip, pool, how) {
  let c = clip;
  let soundEnd = clip.length - PAD;
  if (how === 'head') {
    soundEnd = Math.floor(soundEnd * between(random, 0.3, 0.7));
    c = clip.slice(0, soundEnd);
    for (let i = 0; i < 80 && i < soundEnd; i++) c[soundEnd - 1 - i] *= i / 80; // a 5 ms fade, not a click
  }
  if (random() < 0.3) c = reverb(random, c); // the tail comes after soundEnd; the sound itself stays in place
  const out = new Float32Array(WINDOW_SAMPLES);
  const room = (WINDOW_SAMPLES - soundEnd) / RATE; // seconds the window has after the sound
  let start;
  if (how === 'any') start = Math.floor(random() * (WINDOW_SAMPLES + c.length)) - c.length;
  else start = WINDOW_SAMPLES - Math.floor(RATE * between(random, 0.02, Math.min(0.4, room - 0.01))) - soundEnd;
  const gain = 10 ** (between(random, -20, 0) / 20);
  addAt(out, c, gain, start);
  const level = gain * rms(c);
  const r = random();
  if (r < 0.45) {
    const speech = pick(random, pool);
    const at = Math.floor(random() * (speech.length - out.length));
    const seg = speech.subarray(at, at + out.length);
    addAt(out, seg, level / (rms(seg) || 1e-3) / 10 ** (between(random, 0, 20) / 20));
  } else if (r < 0.7) {
    addAt(out, roadNoise(random, out.length), level / 10 ** (between(random, 0, 20) / 20));
  }
  addAt(out, Float32Array.from({ length: out.length }, () => random() - 0.5), level * 10 ** (between(random, -70, -40) / 20));
  return out;
}

async function prepareWindows(opt, stream) {
  const feat = join(opt.scratch, 'feat');
  if (existsSync(join(feat, 'meta.json'))) return;
  const t0 = Date.now();
  const dir = join(opt.scratch, 'sayings');
  const { clips: pool } = loadClips(join(dir, 'speech-pool'));
  const random = rng(23);
  const positives = [...loadClips(join(dir, 'pos-espeak')).clips, ...loadClips(join(dir, 'pos-vits')).clips];
  const fits = positives.filter((c) => c.length - PAD < WINDOW_SAMPLES - RATE * 0.1);
  const posFd = openSync(join(feat, 'pos.f32'), 'w');
  const negFd = openSync(join(feat, 'negfixed.f32'), 'w');
  const counts = { pos: 0, neg: 0 };
  const put = (fd, key, samples) => {
    const f = D.features(samples);
    const data = f.data.subarray(0, WINDOW * D.FRONT_END.bands);
    writeSync(fd, Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    counts[key]++;
  };
  for (const clip of fits) {
    for (let k = 0; k < 4; k++) put(posFd, 'pos', trainingWindow(random, clip, pool, 'whole'));
    put(negFd, 'neg', trainingWindow(random, clip, pool, 'head'));
  }
  const negatives = [...loadClips(join(dir, 'neg-espeak')).clips, ...loadClips(join(dir, 'neg-vits')).clips];
  for (const clip of negatives) {
    put(negFd, 'neg', trainingWindow(random, clip, pool, 'whole'));
    put(negFd, 'neg', trainingWindow(random, clip, pool, 'any'));
  }
  closeSync(posFd);
  closeSync(negFd);
  const summary = {
    positives: `${fits.length} sayings of the phrase (${positives.length - fits.length} longer than the window left out), 4 windows each: espeak-ng and VCTK VITS training voices`,
    negatives: `${negatives.length} sayings of near words and sentences, 2 windows each; ${fits.length} heads of the phrase`,
    stream: `${stream.speechHours.toFixed(1)} h of LibriSpeech train-clean-100 speech from ${stream.speakers} speakers, roughened, and ${stream.noiseMinutes} min of road-like noise and ${stream.quietMinutes} min of near-quiet`,
  };
  writeFileSync(join(feat, 'meta.json'), JSON.stringify({ window: WINDOW, bands: D.FRONT_END.bands, counts, summary }));
  console.log(`prepare: ${counts.pos} positive and ${counts.neg} fixed negative training windows (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}

async function prepare(opt) {
  for (const p of [join(opt.vitsModel, 'model_file.pth'), opt.python]) if (!existsSync(p)) throw new Error(`missing ${p}: see scripts/wake-probe/README.md`);
  const sets = vitsSets(opt);
  mkdirSync(opt.scratch, { recursive: true });
  writeFileSync(join(opt.scratch, 'sets.json'), JSON.stringify(sets));
  console.log(`prepare: VCTK speakers: ${sets.train.length} train, ${sets.threshold.length} threshold, ${sets.measure.length} measure, 1 fixture`);
  await prepareSayings(opt, sets);
  const stream = await prepareStream(opt);
  await prepareWindows(opt, stream);
}

// ---- trials: held-out sayings in four conditions, and long speech ----

export const CONDITIONS = [
  { key: 'clean', name: 'clean' },
  { key: 'speech10', name: 'under speech at 10 dB', speech: 10 },
  { key: 'speech0', name: 'under speech at 0 dB', speech: 0 },
  { key: 'road5', name: 'under road-like noise at 5 dB', road: 5 },
];

/** A trial clip: the saying at 2 s inside 5 s of the condition's background (or quiet), and where its sound ends. */
function trialClip(random, clip, condition, speech) {
  const out = new Float32Array(Math.max(5 * RATE, 3 * RATE + clip.length));
  const start = 2 * RATE;
  addAt(out, clip, 1, start);
  const level = rms(clip);
  if (condition.speech !== undefined) {
    const at = Math.floor(random() * (speech.length - out.length));
    const seg = speech.subarray(at, at + out.length);
    addAt(out, seg, level / (rms(seg) || 1e-3) / 10 ** (condition.speech / 20));
  }
  if (condition.road !== undefined) addAt(out, roadNoise(random, out.length), level / 10 ** (condition.road / 20));
  addAt(out, Float32Array.from({ length: out.length }, () => random() - 0.5), 3e-4);
  return { samples: out, start: start / RATE, end: (start + clip.length - PAD) / RATE };
}

/** Every trial's window scores, by condition. */
function scoreTrials(net, clips, speech, seed) {
  const random = rng(seed);
  const out = {};
  for (const c of CONDITIONS) out[c.key] = clips.map((clip) => {
    const t = trialClip(random, clip, c, speech);
    return { scores: D.scoreClip(net, t.samples), start: t.start, end: t.end };
  });
  return out;
}

/** Heard when a wake falls between the saying's start and 1 s after its end; the delay is from its end. */
function judgeTrial(net, trial, rule) {
  const hit = D.wakes(trial.scores, rule, D.stepSeconds(net))
    .map((i) => D.windowEnd(net, i))
    .find((t) => t >= trial.start && t <= trial.end + 1);
  return hit === undefined ? { heard: false } : { heard: true, delay: hit - trial.end };
}

/** Each LibriSpeech speaker's speech scored by a fresh listener: [{ speaker, seconds, scores }]. */
async function scoreSpeech(opt, net, subset) {
  const out = [];
  const t0 = Date.now();
  for (const sp of speakersOf(opt, subset)) {
    const audio = await decodeFiles(filesOf(opt, subset, sp), opt.scratch);
    const listener = D.createListener(net, { keepScores: true });
    for (let at = 0; at < audio.length; at += 10 * RATE) listener.push(audio.subarray(at, at + 10 * RATE));
    out.push({ speaker: sp, seconds: audio.length / RATE, scores: Float32Array.from(listener.scores) });
  }
  console.log(`${subset}: ${out.length} speakers, ${(out.reduce((a, s) => a + s.seconds, 0) / 60).toFixed(1)} min scored in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return out;
}

async function speechSample(opt, subset, seconds) {
  const parts = [];
  for (const sp of speakersOf(opt, subset)) parts.push((await decodeFiles(filesOf(opt, subset, sp).slice(0, 2), opt.scratch)).subarray(0, seconds * RATE));
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function falseWakes(net, speech, rule) {
  return speech.reduce((n, s) => n + D.wakes(s.scores, rule, D.stepSeconds(net)).length, 0);
}

function missesBySet(net, trials, rule) {
  const out = {};
  for (const c of CONDITIONS) {
    const sets = [];
    trials[c.key].forEach((t, i) => {
      if (i % 20 === 0) sets.push(0);
      if (!judgeTrial(net, t, rule).heard) sets[sets.length - 1]++;
    });
    out[c.key] = sets;
  }
  return out;
}

// ---- train, calibrate, measure ----

async function train(opt) {
  await run(opt.python, ['-I', join(REPO, 'scripts/wake-probe/train.py'), opt.scratch, REPO, ...(opt.smoke ? ['--smoke'] : [])], 'train.py');
}

/** Throws unless detector.mjs scores train.py's check windows as PyTorch did. */
function checkParity(net, check) {
  const raw = Buffer.from(check.windows, 'base64');
  const data = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length));
  const size = net.window * D.FRONT_END.bands;
  check.scores.forEach((want, i) => {
    const got = D.forward(net, D.windowInput(net, data.subarray(i * size, (i + 1) * size), 0));
    if (Math.abs(got - want) > 1e-4) throw new Error(`detector.mjs scores check window ${i} ${got}, PyTorch ${want}`);
  });
  console.log(`calibrate: detector.mjs scores train.py's ${check.scores.length} check windows as PyTorch does (within 1e-4)`);
}

async function calibrate(opt) {
  const trained = JSON.parse(readFileSync(join(opt.scratch, opt.smoke ? 'model-smoke.json' : 'model-trained.json'), 'utf8'));
  const model = {
    kind: 'voice-kit-wake-cnn',
    phrase: 'Hey Lampas',
    frontEnd: { ...D.FRONT_END },
    window: trained.window,
    step: trained.step,
    scale: trained.scale,
    rule: { threshold: 0.5, consecutive: 2, refractory: 2 },
    trained: trained.trained,
    calibrated: null,
    layers: trained.layers,
  };
  const net = D.loadModel(model);
  checkParity(net, trained.check);
  if (opt.smoke) return true;
  const { clips } = loadClips(join(opt.scratch, 'sayings', 'threshold'));
  const background = await speechSample(opt, 'dev-clean', 60);
  const trials = scoreTrials(net, clips, background, 53);
  const speech = await scoreSpeech(opt, net, 'dev-clean');
  const hours = speech.reduce((a, s) => a + s.seconds, 0) / 3600;
  const candidates = [];
  for (const consecutive of [2, 3]) {
    for (let z = -1; z <= 10; z += 0.05) {
      const threshold = Number((1 / (1 + Math.exp(-z))).toFixed(5)); // a grid even in the network's log-odds
      const rule = { threshold, consecutive, refractory: 2 };
      const fw = falseWakes(net, speech, rule);
      if (fw / hours > CALIBRATION_TARGET) continue;
      const misses = missesBySet(net, trials, rule);
      const total = Object.values(misses).flat().reduce((a, b) => a + b, 0);
      candidates.push({ rule, fw, misses, total });
      break; // the lowest threshold that meets the target, for this many in a row
    }
  }
  if (!candidates.length) throw new Error('no threshold up to 0.99995 keeps the threshold speech under the target');
  candidates.sort((a, b) => a.total - b.total || a.fw - b.fw);
  const best = candidates[0];
  model.rule = best.rule;
  model.calibrated = {
    date: new Date().toISOString().slice(0, 10),
    setWithout: 'the measuring set: set on the threshold set only',
    how: `the lowest threshold (0.27 to 0.99995, even steps of log-odds), for 2 or 3 windows in a row, with at most ${CALIBRATION_TARGET} false wakes an hour on the threshold speech; of those, the one with the fewest threshold misses`,
    speech: `LibriSpeech dev-clean, ${speech.length} speakers, ${(hours * 60).toFixed(1)} min`,
    sayings: `${clips.length} sayings: 3 each by VCTK VITS speakers ${JSON.parse(readFileSync(join(opt.scratch, 'sets.json'), 'utf8')).threshold.join(' ')}, and espeak-ng en-us-nyc and the m8, klatt5, Andy and Annie variants; none trained on`,
    falseWakes: best.fw,
    falseWakesPerHour: Number((best.fw / hours).toFixed(2)),
    missesBySetOf20: best.misses,
    candidates: candidates.map((c) => ({ ...c.rule, falseWakes: c.fw, misses: c.total })),
  };
  writeFileSync(MODEL_PATH, JSON.stringify(model) + '\n');
  console.log(`calibrate: rule ${JSON.stringify(best.rule)}: ${best.fw} false wakes in ${(hours * 60).toFixed(1)} min of threshold speech; misses by set of 20: ${JSON.stringify(best.misses)}`);
  console.log(`calibrate: the model is written to examples/wake-spike/public/models/hey-lampas.json (${statSync(MODEL_PATH).size} bytes)`);
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
}

/** Measures the committed model on the measuring set and prints the table, with the Governor's bar beside each. */
async function measure(opt) {
  const model = JSON.parse(readFileSync(MODEL_PATH, 'utf8'));
  const net = D.loadModel(model);
  const rule = net.rule;
  const { clips } = loadClips(join(opt.scratch, 'sayings', 'measure'));
  const background = await speechSample(opt, 'test-clean', 60);
  const trials = scoreTrials(net, clips, background, 59);
  const speech = await scoreSpeech(opt, net, 'test-clean');
  const minutes = speech.reduce((a, s) => a + s.seconds, 0) / 60;
  const fw = falseWakes(net, speech, rule);
  const perHour = fw / (minutes / 60);
  const rows = [];
  const row = (measureName, result, bar, met) => rows.push([measureName, result, bar, met === null ? '-' : met ? 'met' : 'not met']);
  row('Measuring speech', `${minutes.toFixed(1)} min: LibriSpeech test-clean, ${speech.length} speakers, none trained on or used to set the threshold`, `at least ${BAR.measuringMinutes} min`, minutes >= BAR.measuringMinutes);
  row('False wakes', `${fw} in ${minutes.toFixed(1)} min`, '-', null);
  row('False wakes per hour', perHour.toFixed(2), `at most ${BAR.falseWakesPerHour}`, perHour <= BAR.falseWakesPerHour);
  const delays = [];
  for (const c of CONDITIONS) {
    const sets = [];
    trials[c.key].forEach((t, i) => {
      if (i % 20 === 0) sets.push(0);
      const j = judgeTrial(net, t, rule);
      if (j.heard) delays.push(j.delay);
      else sets[sets.length - 1]++;
    });
    row(`Misses, ${c.name}`, `${sets.join(', ')} in ${sets.length} sets of 20`, `at most ${BAR.missesIn20} in 20`, sets.every((m) => m <= BAR.missesIn20));
  }
  row('Delay, median', `${Math.round(median(delays) * 1000)} ms from the phrase's end to the wake`, '-', null);
  row('Delay, worst', `${Math.round(Math.max(...delays) * 1000)} ms`, '-', null);
  row('Model bytes', `${statSync(MODEL_PATH).size.toLocaleString('en-GB')} (hey-lampas.json, ${net.parameters.toLocaleString('en-GB')} weights as base64 float32)`, '-', null);
  const met = rows.filter((r) => r[3] !== '-').every((r) => r[3] === 'met');
  console.log(`measure: rule ${JSON.stringify(rule)}, model trained at ${model.trained.commit.slice(0, 12)} on ${model.trained.date}, ${clips.length} held-out sayings in each condition`);
  if (opt.markdown) {
    console.log(['| Measure | Result | The Governor\'s bar | Met |', '|---|---|---|---|', ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n'));
  } else {
    const widths = [0, 1, 2, 3].map((i) => Math.max(...rows.map((r) => r[i].length), 7));
    for (const r of [['Measure', 'Result', "The Governor's bar", 'Met'], ...rows]) console.log(r.map((c, i) => c.padEnd(widths[i])).join('  '));
  }
  console.log(`measure: the Governor's bar is ${met ? 'MET' : 'NOT MET'}`);
  return met;
}

async function main(argv) {
  const opt = options(argv);
  const commands = { prepare, train, calibrate, measure };
  if (!commands[opt.command]) throw new Error(`unknown command ${opt.command}: use prepare, train, calibrate or measure`);
  const result = await commands[opt.command](opt);
  return result !== false;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (ok) => process.exit(ok ? 0 : 1),
    (e) => {
      console.error(e.stack ?? e.message);
      process.exit(2);
    },
  );
}

