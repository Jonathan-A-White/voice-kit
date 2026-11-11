// Makes the sets of 20 tries that scripts/measure.mjs counts misses on: 'Hey Lampas' said by espeak-ng in voices the
// model never trained on, each set one condition:
//
//   clean         the saying alone, in near-quiet
//   bible10       under the recorded John (the cached Bible audio) at 10 dB speech-to-speech
//   bible0        the same, at 0 dB: the Bible as loud as the saying
//   brown5        under brown noise, a road proxy, at 5 dB
//
// Run it after fetch-bible-audio.mjs (measure.mjs runs it for a set that is missing):
//
//   node examples/wake-spike/scripts/make-tries.mjs [--force]
//
// The 20 sayings are the same in every set, so the sets differ only in what is behind them. Each try is 5 s with the
// saying starting at 2 s; its manifest holds where the phrase starts and ends, in seconds from the try's first sample.
// Output (outside the repo): ~/.cache/voice-kit-wake-spike/tries/<set>.wav and <set>.json.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, rms, rng, say } from '../../../scripts/wake-probe/probe.mjs';
import { DEFAULT_DIR, cachedFiles } from './fetch-bible-audio.mjs';

export const RATE = 16000;
export const TRY_SECONDS = 5;
export const SAYING_AT = 2; // seconds into the try at which the saying starts
export const PAD = 0.05; // quiet probe.mjs's say() keeps around a saying, seconds
export const TRIES_PER_SET = 20;
export const SETS = [
  { key: 'clean', name: 'clean' },
  { key: 'bible10', name: 'under Bible audio at 10 dB', bible: 10 },
  { key: 'bible0', name: 'under Bible audio at 0 dB', bible: 0 },
  { key: 'brown5', name: 'under brown noise (a road proxy) at 5 dB', brown: 5 },
];
export const TRIES_DIR = join(DEFAULT_DIR, '..', 'tries');

// The voices the model did not train on, named in scripts/wake-probe/README.md ('The three sets', Measure row): the
// measuring set's espeak-ng voice en-029 and the m4, f4 and klatt4 variants. The training voices with those variants,
// and en-029 with the training variants, are also unseen, since no (voice, variant) pair is in two sets.
const TRAIN_VOICES = ['en-gb', 'en-us', 'en-gb-scotland', 'en-gb-x-gbclan', 'en-gb-x-rp', 'en-gb-x-gbcwmd'];
const TRAIN_VARIANTS = ['', '+m1', '+m2', '+m3', '+m5', '+m6', '+m7', '+f1', '+f2', '+f3', '+f5', '+klatt', '+klatt2', '+klatt3', '+croak', '+whisper'];
const HELD_OUT_VARIANTS = ['+m4', '+f4', '+klatt4'];
export const VOICES = [
  ...TRAIN_VOICES.flatMap((voice) => HELD_OUT_VARIANTS.map((variant) => voice + variant)),
  ...[...new Set(['', ...TRAIN_VARIANTS, ...HELD_OUT_VARIANTS])].map((variant) => 'en-029' + variant),
];
const PHRASES = ['Hey Lampas', 'Hey, Lampas', 'Hey Lampas.', 'Hey Lampas!', 'hey lampas'];
const SPEEDS = [120, 145, 170, 195];
const PITCHES = [25, 50, 75];

function shuffled(random, list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const pick = (random, list) => list[Math.floor(random() * list.length)];

/** Brown noise (white noise integrated, leaky) with rms 1. */
export function brownNoise(random, n) {
  const out = new Float32Array(n);
  let b = 0;
  for (let i = 0; i < n; i++) {
    b = 0.998 * b + 0.05 * (random() * 2 - 1);
    out[i] = b;
  }
  const level = rms(out) || 1;
  for (let i = 0; i < n; i++) out[i] /= level;
  return out;
}

/** A 16-bit mono WAV file's samples as floats in [-1, 1], and its rate. */
export function readWav(path) {
  const buf = readFileSync(path);
  let at = 12;
  let rate = 0;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') rate = buf.readUInt32LE(at + 12);
    if (id === 'data') {
      const out = new Float32Array(size >> 1);
      for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(at + 8 + i * 2) / 32768;
      return { rate, samples: out };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${path}`);
}

export function writeWav(path, samples) {
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + samples.length * 2, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(samples.length * 2, 40);
  const body = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) body.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32768))), i * 2);
  writeFileSync(path, Buffer.concat([head, body]));
}

/** A set read back: { set, tries: [{ samples, voice, phrase, start, end }] }, times in seconds from each try's first sample. */
export function readSet(key, dir = TRIES_DIR) {
  const manifest = JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8'));
  const { samples } = readWav(join(dir, `${key}.wav`));
  return { ...manifest, tries: manifest.tries.map((t) => ({ ...t, samples: samples.subarray(t.offset, t.offset + t.length) })) };
}

/** The 20 sayings: [{ clip, voice, phrase, speed, pitch }], each by a different voice, the same for every set. */
async function sayings() {
  const random = rng(77);
  const out = [];
  for (const voice of shuffled(random, VOICES).slice(0, TRIES_PER_SET)) {
    const phrase = pick(random, PHRASES);
    const speed = pick(random, SPEEDS);
    const pitch = pick(random, PITCHES);
    out.push({ clip: await say(phrase, voice, speed, pitch), voice, phrase, speed, pitch });
  }
  return out;
}

/** 5 s of cached Bible audio for each try, the same for every Bible set: [Float32Array]. */
async function bibleSegments(files, random) {
  const out = [];
  const decoded = new Map();
  while (out.length < TRIES_PER_SET) {
    const file = pick(random, files);
    if (!decoded.has(file)) decoded.set(file, await decode(file));
    const audio = decoded.get(file);
    const at = Math.floor(random() * (audio.length - TRY_SECONDS * RATE));
    const segment = audio.slice(at, at + TRY_SECONDS * RATE);
    if (rms(segment) > 0.01) out.push(segment); // not a pause between verses
  }
  return out;
}

/** The try: the saying at SAYING_AT inside 5 s of the set's background, and where the phrase ends. */
export function mixTry(clip, set, background, random) {
  const length = Math.max(TRY_SECONDS * RATE, (SAYING_AT + 1) * RATE + clip.length);
  const out = new Float32Array(length);
  const at = Math.round(SAYING_AT * RATE);
  for (let i = 0; i < clip.length; i++) out[at + i] += clip[i];
  const level = rms(clip);
  if (set.bible !== undefined) {
    const scale = level / (rms(background) || 1e-3) / 10 ** (set.bible / 20);
    for (let i = 0; i < Math.min(length, background.length); i++) out[i] += background[i] * scale;
  }
  if (set.brown !== undefined) {
    const noise = brownNoise(random, length);
    const scale = level / 10 ** (set.brown / 20);
    for (let i = 0; i < length; i++) out[i] += noise[i] * scale;
  }
  for (let i = 0; i < length; i++) out[i] += (random() - 0.5) * 3e-4; // the near-quiet of a real room
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.95) for (let i = 0; i < length; i++) out[i] *= 0.95 / peak;
  return { samples: out, start: SAYING_AT, end: SAYING_AT + (clip.length - PAD * RATE) / RATE };
}

/** Makes every set that is not already there (or all, with force). Returns the keys of the sets it made. */
export async function makeTries({ dir = TRIES_DIR, bibleDir = DEFAULT_DIR, force = false, say: log = console.log } = {}) {
  const todo = SETS.filter((set) => force || !existsSync(join(dir, `${set.key}.json`)));
  if (todo.length === 0) return [];
  const files = cachedFiles(bibleDir);
  if (todo.some((set) => set.bible !== undefined) && files.length === 0) throw new Error(`no Bible audio in ${bibleDir}: run node examples/wake-spike/scripts/fetch-bible-audio.mjs first`);
  mkdirSync(dir, { recursive: true });
  const heard = await sayings();
  log(`tries: ${heard.length} sayings by ${new Set(heard.map((h) => h.voice)).size} espeak-ng voices the model never trained on`);
  const segments = todo.some((set) => set.bible !== undefined) ? await bibleSegments(files, rng(5)) : [];
  for (const set of todo) {
    const random = rng(100 + SETS.indexOf(set));
    const tries = [];
    const parts = [];
    let offset = 0;
    heard.forEach((h, i) => {
      const mixed = mixTry(h.clip, set, segments[i], random);
      tries.push({ voice: h.voice, phrase: h.phrase, speed: h.speed, pitch: h.pitch, offset, length: mixed.samples.length, start: mixed.start, end: mixed.end });
      parts.push(mixed.samples);
      offset += mixed.samples.length;
    });
    const all = new Float32Array(offset);
    let at = 0;
    for (const part of parts) {
      all.set(part, at);
      at += part.length;
    }
    writeWav(join(dir, `${set.key}.wav`), all);
    writeFileSync(join(dir, `${set.key}.json`), JSON.stringify({ key: set.key, name: set.name, snr: set.bible ?? set.brown ?? null, tries }, null, 1));
    log(`tries: ${set.key}: ${tries.length} tries (${set.name})`);
  }
  return todo.map((set) => set.key);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  makeTries({ force: process.argv.includes('--force') }).then(
    () => process.exit(0),
    (err) => {
      console.error(`tries: ${err.message}`);
      process.exit(1);
    },
  );
}
