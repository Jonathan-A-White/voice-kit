// The wake detector of the spike page (mw-rdpwdp1.3): a TypeScript port of scripts/wake-probe/detector.mjs, run on the
// committed model. Network-free and tool-free: no espeak-ng, no ffmpeg, no browser. The fixture is one espeak-ng saying
// of 'Hey Lampas' in a voice the model never trained on (en-029 with the m4 variant), kept as data.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDetector, createListener, createResampler, loadModel } from 'voice-kit/wake';
import type { Net } from 'voice-kit/wake';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const MODEL = here('../public/models/hey-lampas.json');
const FIXTURE = here('./fixtures/hey-lampas-espeak.wav');
const ENGLISH = here('../../../packages/testing/clips/english.wav');
const PROBE = new URL('../../../scripts/wake-probe/detector.mjs', import.meta.url).href;

/** The samples of a 16 kHz, 16-bit mono PCM WAV file as floats in [-1, 1]. */
function readWav(path: string): Float32Array {
  const buf = readFileSync(path);
  expect(buf.toString('ascii', 0, 4)).toBe('RIFF');
  let at = 12;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') {
      expect(buf.readUInt16LE(at + 10)).toBe(1); // mono
      expect(buf.readUInt32LE(at + 12)).toBe(16000);
      expect(buf.readUInt16LE(at + 22)).toBe(16);
    }
    if (id === 'data') {
      const out = new Float32Array(size >> 1);
      for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(at + 8 + i * 2) / 32768;
      return out;
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${path}`);
}

/** `clip` with `before` seconds of near-silence ahead of it and `after` behind (the network needs 1.6 s of context). */
function padded(clip: Float32Array, before: number, after: number): Float32Array {
  const out = new Float32Array(Math.round((before + after) * 16000) + clip.length);
  out.set(clip, Math.round(before * 16000));
  return out;
}

const model = JSON.parse(readFileSync(MODEL, 'utf8')) as Parameters<typeof loadModel>[0];
const net = (): Net => loadModel(model);

interface Probe {
  loadModel(model: unknown): unknown;
  scoreClip(net: unknown, samples: Float32Array): Float32Array | number[];
  listen(net: unknown, samples: Float32Array): { time: number; score: number; window: number }[];
}
const probe = async (): Promise<Probe> => (await import(/* @vite-ignore */ PROBE)) as Probe;

/** Pushes `samples` through a detector in chunks of `size`; every wake found. */
function wakesOf(samples: Float32Array, size = 4000) {
  const detector = createDetector(net());
  const found = [];
  for (let at = 0; at < samples.length; at += size) found.push(...detector.push(samples.subarray(at, at + size)));
  return { found, detector };
}

describe('the wake detector on the committed model', () => {
  it('wakes exactly once on the fixture saying, with its audio time and score', () => {
    const { found } = wakesOf(padded(readWav(FIXTURE), 1, 2));
    expect(found).toHaveLength(1);
    expect(found[0].score).toBeGreaterThanOrEqual(model.rule.threshold);
    // the saying starts at 1 s and is about 1.3 s long: the wake comes after it has been said
    expect(found[0].time).toBeGreaterThan(1.5);
    expect(found[0].time).toBeLessThan(3.5);
  });

  it('wakes once for a saying heard twice in a row less than the cooldown apart', () => {
    const clip = readWav(FIXTURE);
    const twice = new Float32Array(Math.round(7 * 16000));
    twice.set(clip, 16000);
    twice.set(clip, 16000 + clip.length + 3200);
    expect(wakesOf(twice).found).toHaveLength(1);
  });

  it('does not wake on "Please read me the first chapter"', () => {
    expect(wakesOf(padded(readWav(ENGLISH), 1, 1)).found).toHaveLength(0);
  });

  it('does not wake on 30 s of silence', () => {
    expect(wakesOf(new Float32Array(30 * 16000)).found).toHaveLength(0);
  });

  it('counts its compute: milliseconds spent, seconds of audio heard, and milliseconds per second', () => {
    const { detector } = wakesOf(padded(readWav(FIXTURE), 1, 2));
    const stats = detector.stats();
    expect(stats.computeMs).toBeGreaterThan(0);
    expect(stats.audioSeconds).toBeCloseTo((readWav(FIXTURE).length + 3 * 16000) / 16000, 1);
    expect(stats.msPerSecond).toBeGreaterThan(0);
    expect(stats.msPerSecond).toBeCloseTo(stats.computeMs / stats.audioSeconds, 6);
  });

  it('finds the same wakes however the audio is cut into chunks', () => {
    const audio = padded(readWav(FIXTURE), 1, 2);
    const whole = wakesOf(audio, audio.length).found;
    for (const size of [1, 127, 128, 441, 5000]) {
      const cut = wakesOf(audio, size).found;
      expect(cut.map((w) => w.window)).toEqual(whole.map((w) => w.window));
    }
  }, 60_000);

  it('refuses a model it does not know', () => {
    expect(() => loadModel({ ...model, kind: 'something-else' })).toThrow(/not a wake model/);
    expect(() => loadModel({ ...model, frontEnd: { ...model.frontEnd, bands: 64 } })).toThrow(/front end/);
  });
});

describe('the port agrees with scripts/wake-probe/detector.mjs', () => {
  const clips: [string, Float32Array][] = [
    ['the fixture saying', padded(readWav(FIXTURE), 1, 2)],
    ['"Please read me the first chapter"', padded(readWav(ENGLISH), 1, 1)],
    [
      'noise',
      Float32Array.from({ length: 5 * 16000 }, (_, i) => 0.2 * Math.sin(i * 0.37) * Math.sin(i * 0.0011) + 0.05 * Math.sin(i * 1.9)),
    ],
  ];
  for (const [name, audio] of clips) {
    it(`gives the same scores and wakes on ${name}, to within 0.0001`, async () => {
      const original = await probe();
      const want = Array.from(original.scoreClip(original.loadModel(model), audio));
      const listener = createListener(net(), { keepScores: true });
      listener.push(audio);
      expect(listener.scores).toHaveLength(want.length);
      expect(want.length).toBeGreaterThan(10);
      listener.scores.forEach((score, i) => expect(Math.abs(score - want[i])).toBeLessThan(0.0001));
      const wantWakes = original.listen(original.loadModel(model), audio);
      expect(wakesOf(audio).found.map((w) => w.window)).toEqual(wantWakes.map((w) => w.window));
    }, 60_000);
  }
});

describe('the resampler', () => {
  const tone = (hz: number, rate: number, seconds: number) => Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate));
  const rms = (x: Float32Array, from = 0) => Math.sqrt(x.subarray(from).reduce((a, v) => a + v * v, 0) / (x.length - from));

  it('turns 48 kHz and 44.1 kHz into 16 kHz of the same length and pitch', () => {
    for (const rate of [48000, 44100, 32000, 16000]) {
      const out = createResampler(rate, 16000).push(tone(1000, rate, 2));
      expect(Math.abs(out.length - 32000)).toBeLessThan(40);
      // after the filter has settled the tone is as loud as a tone made at 16 kHz, and crosses zero as often
      expect(rms(out, 400)).toBeCloseTo(rms(tone(1000, 16000, 1)), 2);
      let crossings = 0;
      for (let i = 401; i < out.length; i++) if (out[i - 1] < 0 !== out[i] < 0) crossings++;
      expect(Math.abs(crossings - 2000 * ((out.length - 400) / 16000))).toBeLessThan(4);
    }
  });

  it('keeps a tone above the new rate out of the result instead of folding it back', () => {
    const out = createResampler(48000, 16000).push(tone(11000, 48000, 1)); // 11 kHz folds to 5 kHz at 16 kHz
    expect(rms(out, 400)).toBeLessThan(0.02);
  });

  it('gives the same samples however the input is cut', () => {
    const input = tone(700, 44100, 1);
    const whole = createResampler(44100, 16000).push(input);
    const r = createResampler(44100, 16000);
    const parts: number[] = [];
    for (let at = 0; at < input.length; at += 128) parts.push(...r.push(input.subarray(at, at + 128)));
    expect(parts.length).toBe(whole.length);
    parts.forEach((v, i) => expect(Math.abs(v - whole[i])).toBeLessThan(1e-6));
  });

  it('still hears the saying after 16 kHz is made 48 kHz and brought back', () => {
    const audio = padded(readWav(FIXTURE), 1, 2);
    const up = createResampler(16000, 48000).push(audio);
    const detector = createDetector(net(), { inputRate: 48000 });
    const found = [];
    for (let at = 0; at < up.length; at += 128) found.push(...detector.push(up.subarray(at, at + 128)));
    expect(found).toHaveLength(1);
  }, 60_000);
});
