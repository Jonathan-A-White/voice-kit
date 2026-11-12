// A car's Bluetooth hands-free microphone, simulated (story mw-rdpwdp1.12). The page listens through the phone's
// microphone input; in a car that plays the Bible over Bluetooth, the phone switches to the hands-free profile (HFP)
// and the input is the car's own microphone, sent over a call-quality link:
//
//   voice + road noise + the Bible leaking back from the car's speakers      (levels at the microphone)
//   -> the car's noise suppressor (spectral gating)                          suppress()
//   -> automatic gain                                                        agc()
//   -> the link: narrowband (8 kHz, 300-3400 Hz, CVSD) or wideband (16 kHz, mSBC)   linkNarrow() / linkWide() + msbc()
//   -> the phone resamples to what the page asks for (16 kHz here)
//
// This is a model of that chain from its published parameters, not a recording of one car, and every number in it is a
// guess at a kind of car (the choices are in `random`). All of it is plain JavaScript made here (MIT) except the
// wideband codec, which is FFmpeg's SBC encoder and decoder in mSBC mode, run as a tool and never shipped. CVSD is the
// Bluetooth Core Specification's continuously variable slope delta modulation, written from its published parameters
// (Vol 2, Part B, section 9: step 10 to 1280 of 16-bit units, 4 equal bits to grow, decay 1/1024, accumulator 1 - 1/32).
//
// Levels (`roadDb`, `leakDb`) are the voice's level over the interferer's, in dB at the microphone, before the suppressor:
// 10 is the road 10 dB under the voice, 0 is as loud, -10 is the Bible 10 dB louder than the voice.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fft } from './detector.mjs';

export const RATE = 16000;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';

const rmsOf = (x) => {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
};
const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
const between = (random, lo, hi) => lo + random() * (hi - lo);

/** The conditions of the held-out sets: each link clean, under road noise at 10 and 0 dB, the Bible at 0 and -10 dB, and both. */
export const HANDSFREE_CONDITIONS = ['nb', 'wb'].flatMap((link) => {
  const where = link === 'nb' ? 'narrowband' : 'wideband';
  return [
    { key: `${link}-clean`, name: `${where} hands-free, clean`, link },
    { key: `${link}-road10`, name: `${where} hands-free, road noise at 10 dB`, link, road: 10 },
    { key: `${link}-road0`, name: `${where} hands-free, road noise at 0 dB`, link, road: 0 },
    { key: `${link}-bible0`, name: `${where} hands-free, Bible leaking at 0 dB`, link, leak: 0 },
    { key: `${link}-bible-10`, name: `${where} hands-free, Bible leaking at -10 dB`, link, leak: -10 },
    { key: `${link}-both`, name: `${where} hands-free, road noise at 5 dB and Bible leaking at -5 dB`, link, road: 5, leak: -5 },
  ];
});

/** The wideband link's band: 80 Hz to 7 kHz. */
export const WIDE = Object.freeze({ highpassHz: 80, lowpassHz: 7000 });

/** Brown noise (white noise integrated, leaky) with rms 1. */
export function brownNoise(random, n) {
  const out = new Float32Array(n);
  let b = 0;
  for (let i = 0; i < n; i++) {
    b = 0.998 * b + 0.05 * (random() * 2 - 1);
    out[i] = b;
  }
  const level = rmsOf(out) || 1;
  for (let i = 0; i < n; i++) out[i] /= level;
  return out;
}

// ---- filters ----

const kernelCache = new Map();
/** The polyphase kernel of resampling from -> to with a low-pass at `cutoff` Hz: { phases, taps, half, table }. */
function kernel(from, to, cutoff, zeros) {
  const key = `${from}/${to}/${cutoff}/${zeros}`;
  if (kernelCache.has(key)) return kernelCache.get(key);
  const g = gcd(from, to);
  const phases = to / g;
  const fc = cutoff / from; // cycles per input sample
  const half = Math.ceil(zeros / (2 * fc));
  const taps = 2 * half;
  const table = new Float64Array(phases * taps);
  for (let p = 0; p < phases; p++) {
    const f = p / phases; // the output's place after its input sample, in input samples
    for (let t = 0; t < taps; t++) {
      const u = t - half + 1 - f; // input sample (base - half + 1 + t) minus the output's position (base + f)
      const a = Math.abs(u) / half;
      const w = a >= 1 ? 0 : 0.42 + 0.5 * Math.cos(Math.PI * a) + 0.08 * Math.cos(2 * Math.PI * a); // Blackman
      const arg = 2 * Math.PI * fc * u;
      table[p * taps + t] = (Math.abs(arg) < 1e-12 ? 2 * fc : (2 * fc * Math.sin(arg)) / arg) * w;
    }
  }
  const out = { phases, taps, half, table, g };
  kernelCache.set(key, out);
  return out;
}

/** Samples at `from` Hz to `to` Hz by a windowed-sinc (Blackman) polyphase filter; the length scales, the edges are zeros. */
export function resample(x, from, to, { cutoff = 0.46 * Math.min(from, to), zeros = 16 } = {}) {
  const k = kernel(from, to, cutoff, zeros);
  const n = Math.floor((x.length * to) / from);
  const out = new Float32Array(n);
  const stepIn = from / k.g; // input samples x phases per output sample
  for (let j = 0; j < n; j++) {
    const pos = j * stepIn; // in units of 1/phases input samples
    const base = Math.floor(pos / k.phases);
    const p = pos - base * k.phases;
    const row = p * k.taps;
    const start = base - k.half + 1;
    let s = 0;
    for (let t = 0; t < k.taps; t++) {
      const i = start + t;
      if (i >= 0 && i < x.length) s += x[i] * k.table[row + t];
    }
    out[j] = s;
  }
  return out;
}

/** A 4th-order Butterworth high-pass (two biquads) at `fc` Hz: a call's low cut. */
export function highpass(x, rate, fc) {
  let y = Float64Array.from(x);
  for (const q of [0.5411961, 1.3065630]) {
    const w0 = (2 * Math.PI * fc) / rate;
    const alpha = Math.sin(w0) / (2 * q);
    const cosw = Math.cos(w0);
    const a0 = 1 + alpha;
    const b0 = (1 + cosw) / 2 / a0;
    const b1 = -(1 + cosw) / a0;
    const b2 = b0;
    const a1 = (-2 * cosw) / a0;
    const a2 = (1 - alpha) / a0;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    const out = new Float64Array(y.length);
    for (let i = 0; i < y.length; i++) {
      const v = b0 * y[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = y[i];
      y2 = y1;
      y1 = v;
      out[i] = v;
    }
    y = out;
  }
  return Float32Array.from(y);
}

/** A linear-phase low-pass FIR at `fc` Hz (Blackman, `taps` long, odd); zero delay. */
export function lowpassFir(x, rate, fc, taps = 321) {
  const c = (taps - 1) / 2;
  const h = new Float64Array(taps);
  const f = fc / rate;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const u = i - c;
    const w = 0.42 + 0.5 * Math.cos((Math.PI * u) / (c + 1)) + 0.08 * Math.cos((2 * Math.PI * u) / (c + 1));
    h[i] = (u === 0 ? 2 * f : Math.sin(2 * Math.PI * f * u) / (Math.PI * u)) * w;
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    let s = 0;
    const lo = Math.max(0, c - i);
    const hi = Math.min(taps, x.length - i + c);
    for (let t = lo; t < hi; t++) s += x[i + t - c] * h[t];
    out[i] = s;
  }
  return out;
}

/** The call band: a 4th-order high-pass at `lo` and a steep low-pass whose -6 dB point is just under `hi`. */
export function bandpass(x, rate, lo, hi) {
  return lowpassFir(highpass(x, rate, lo), rate, hi - 50);
}

// ---- the codecs ----

/**
 * CVSD at 8 kHz in and out (the Bluetooth narrowband codec): the input is brought to 64 kbit/s by linear
 * interpolation, one bit per step follows it, and the decoder's integrator is averaged back down to 8 kHz.
 */
export function cvsd(x) {
  const up = 8;
  const HDECAY = 1 - 1 / 32;
  const SDECAY = 1 - 1 / 1024;
  const DMIN = 10;
  const DMAX = 1280;
  const out = new Float32Array(x.length);
  let acc = 0;
  let step = DMIN;
  let history = 0; // the last 4 bits, as 4 bits
  let seen = 0;
  const stage = new Float64Array(x.length * up);
  for (let i = 0; i < x.length; i++) {
    const a = x[i] * 32768;
    const b = (i + 1 < x.length ? x[i + 1] : x[i]) * 32768;
    for (let k = 0; k < up; k++) {
      const input = a + ((b - a) * k) / up;
      const bit = input >= acc ? 1 : 0;
      history = ((history << 1) | bit) & 15;
      seen = Math.min(4, seen + 1);
      const run = seen === 4 && (history === 0 || history === 15);
      step = run ? Math.min(DMAX, step + DMIN) : Math.max(DMIN, step * SDECAY);
      acc = Math.max(-32768, Math.min(32767, acc * HDECAY + (bit ? step : -step)));
      stage[i * up + k] = acc;
    }
  }
  // the decoder's output filter: two averages of 8, then every 8th sample (a CIC low-pass; it droops a little at 3.4 kHz)
  const once = new Float64Array(stage.length);
  let run = 0;
  for (let i = 0; i < stage.length; i++) {
    run += stage[i] - (i >= up ? stage[i - up] : 0);
    once[i] = run / up;
  }
  const twice = new Float64Array(stage.length);
  run = 0;
  for (let i = 0; i < once.length; i++) {
    run += once[i] - (i >= up ? once[i - up] : 0);
    twice[i] = run / up;
  }
  // the two averages centre 7 samples behind; stage[i * up + k] was coded from the input k / up of the way from x[i] to x[i + 1]
  for (let i = 0; i < out.length; i++) out[i] = twice[Math.min(stage.length - 1, i * up + up - 1)] / 32768;
  return out;
}

/** The narrowband link: 300-3400 Hz, 8 kHz, CVSD, then back up to 16 kHz as the phone's resampler does. */
export function linkNarrow(x, { upsample = 'sinc' } = {}) {
  const high = highpass(x, RATE, 300);
  const down = resample(high, RATE, 8000, { cutoff: 3350, zeros: 24 });
  const coded = cvsd(down);
  let up;
  if (upsample === 'linear') {
    up = new Float32Array(coded.length * 2);
    for (let i = 0; i < coded.length; i++) {
      up[2 * i] = coded[i];
      up[2 * i + 1] = (coded[i] + (coded[i + 1] ?? coded[i])) / 2;
    }
  } else up = resample(coded, 8000, RATE, { cutoff: 3500, zeros: 16 });
  const out = new Float32Array(x.length);
  out.set(up.subarray(0, Math.min(up.length, out.length)));
  return out;
}

/** The wideband link before its codec: 80 Hz to 7 kHz, as the 16 kHz speech link keeps. */
export function linkWide(x) {
  return lowpassFir(highpass(x, RATE, WIDE.highpassHz), RATE, WIDE.lowpassHz - 150, 161);
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (c) => (err += c));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim().slice(0, 300)}`))));
  });
}

/**
 * mSBC (the Bluetooth wideband codec) through FFmpeg's SBC encoder in mSBC mode and its decoder, many clips in one
 * run: they are laid one after another with half a second between, a click opens the run so the codec's delay is
 * found and taken out, and each clip is cut back to its own length.
 */
export async function msbc(clips) {
  const gap = RATE / 2;
  const lead = RATE / 2;
  const total = lead + clips.reduce((a, c) => a + c.length + gap, 0);
  const all = new Int16Array(total);
  all[Math.floor(lead / 2)] = 16000; // the click
  let at = lead;
  const starts = [];
  for (const c of clips) {
    starts.push(at);
    for (let i = 0; i < c.length; i++) all[at + i] = Math.max(-32768, Math.min(32767, Math.round(c[i] * 32768)));
    at += c.length + gap;
  }
  const dir = mkdtempSync(join(tmpdir(), 'wake-msbc-'));
  try {
    writeFileSync(join(dir, 'in.raw'), Buffer.from(all.buffer));
    await run(['-f', 's16le', '-ar', '16000', '-ac', '1', '-i', join(dir, 'in.raw'), '-c:a', 'sbc', '-msbc', '1', '-f', 'sbc', join(dir, 'coded.sbc')]);
    await run(['-f', 'sbc', '-i', join(dir, 'coded.sbc'), '-f', 's16le', '-ar', '16000', '-ac', '1', join(dir, 'out.raw')]);
    const raw = readFileSync(join(dir, 'out.raw'));
    const dec = new Float32Array(raw.length >> 1);
    for (let i = 0; i < dec.length; i++) dec[i] = raw.readInt16LE(i * 2) / 32768;
    let click = Math.floor(lead / 2);
    let best = 0;
    for (let i = click; i < Math.min(dec.length, click + 1600); i++) if (Math.abs(dec[i]) > best) (best = Math.abs(dec[i])), (click = i);
    const delay = click - Math.floor(lead / 2);
    return clips.map((c, i) => {
      const out = new Float32Array(c.length);
      const from = starts[i] + delay;
      for (let j = 0; j < c.length && from + j < dec.length; j++) out[j] = dec[from + j];
      return out;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- the microphone and what the car does to it ----

/**
 * What the car's microphone hears: the voice, road noise `roadDb` under it and the Bible's leak `leakDb` under it
 * (negative: over it). `level` is the voice's level the dB are against (default: the voice's rms).
 */
export function carMic(voice, { road = null, roadDb = 10, leak = null, leakDb = 0, level } = {}) {
  const ref = level ?? rmsOf(voice);
  const out = Float32Array.from(voice);
  const add = (noise, db) => {
    const scale = ref / 10 ** (db / 20) / (rmsOf(noise) || 1);
    for (let i = 0; i < out.length && i < noise.length; i++) out[i] += noise[i] * scale;
  };
  if (road) add(road, roadDb);
  if (leak) add(leak, leakDb);
  return out;
}

/** An inverse FFT through the forward one. */
function ifft(re, im) {
  for (let i = 0; i < im.length; i++) im[i] = -im[i];
  fft(re, im);
  const n = re.length;
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

/**
 * The car's noise suppressor: a spectral gate. Each bin's steady floor is tracked (it falls at once and rises a few
 * dB a second, so a long sound is taken for floor in time), and the bin is cut by what its power is not over that floor,
 * down to `floorDb`. It closes over three frames and opens at once; so it cuts steady noise and clips the quiet tails
 * and the weak consonants of a voice, which is what a hands-free call sounds like.
 */
export function suppress(random, x, { floorDb = between(random, -24, -10), over = between(random, 1.2, 2.6), riseDbPerSecond = between(random, 2, 6) } = {}) {
  const N = 512;
  const HOP = 128;
  const bins = N / 2 + 1;
  const hann = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  const gmin = 10 ** (floorDb / 20);
  const rise = 10 ** ((riseDbPerSecond * HOP) / RATE / 10);
  const frames = Math.max(0, Math.floor((x.length - N) / HOP) + 1);
  const out = new Float64Array(x.length + N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const smooth = new Float64Array(bins);
  const floor = new Float64Array(bins);
  const gain = new Float64Array(bins).fill(1);
  const BIAS = 2.2; // the floor tracker sits under the mean of noisy power; this brings it back up
  for (let f = 0; f < frames; f++) {
    const at = f * HOP;
    for (let i = 0; i < N; i++) {
      re[i] = x[at + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im);
    const spec = new Float64Array(bins * 2);
    for (let k = 0; k < bins; k++) {
      spec[2 * k] = re[k];
      spec[2 * k + 1] = im[k];
      const p = re[k] * re[k] + im[k] * im[k];
      smooth[k] = f === 0 ? p : 0.6 * smooth[k] + 0.4 * p;
      floor[k] = f === 0 ? smooth[k] : smooth[k] < floor[k] ? smooth[k] : floor[k] * rise;
      const want = Math.max(gmin, Math.min(1, 1 - (over * BIAS * floor[k]) / (smooth[k] + 1e-20)));
      gain[k] = want > gain[k] ? want : gain[k] + (want - gain[k]) / 3;
    }
    for (let k = 0; k < bins; k++) {
      re[k] = spec[2 * k] * gain[k];
      im[k] = spec[2 * k + 1] * gain[k];
      if (k > 0 && k < N / 2) {
        re[N - k] = re[k];
        im[N - k] = -im[k];
      }
    }
    ifft(re, im);
    for (let i = 0; i < N; i++) out[at + i] += re[i] * hann[i];
  }
  // Hann analysis and synthesis at a quarter-window hop sum to 1.5
  const result = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) result[i] = out[i] / 1.5;
  return result;
}

/**
 * Automatic gain: the gain moves toward the level that brings the voice's smoothed level to `target` (rms), up at
 * `upDbPerSecond` and down at `downDbPerSecond`, to at most `maxGainDb`; a soft clip keeps it under full scale.
 */
export function agc(x, rate = RATE, { target = 0.07, upDbPerSecond = 30, downDbPerSecond = 200, maxGainDb = 30 } = {}) {
  const out = new Float32Array(x.length);
  const up = 10 ** (upDbPerSecond / 20 / rate);
  const down = 10 ** (-downDbPerSecond / 20 / rate);
  const maxGain = 10 ** (maxGainDb / 20);
  const smooth = 1 - Math.exp(-1 / (0.05 * rate));
  let level = 0;
  let gain = 1;
  for (let i = 0; i < x.length; i++) {
    level += smooth * (x[i] * x[i] - level);
    const want = Math.min(maxGain, target / (Math.sqrt(level) + 1e-6));
    gain = want < gain ? Math.max(want, gain * down) : Math.min(want, gain * up);
    const v = x[i] * gain;
    out[i] = Math.abs(v) < 0.8 ? v : Math.sign(v) * (0.8 + 0.2 * Math.tanh((Math.abs(v) - 0.8) / 0.2));
  }
  return out;
}

/** What one car's chain does, drawn from `random`: the suppressor's and the gain's settings and the phone's resampler. */
export function carSettings(random) {
  return {
    suppress: { floorDb: between(random, -24, -10), over: between(random, 1.2, 2.6), riseDbPerSecond: between(random, 2, 6) },
    agc: { target: between(random, 0.03, 0.12), upDbPerSecond: between(random, 15, 60), maxGainDb: between(random, 20, 36) },
    upsample: random() < 0.25 ? 'linear' : 'sinc',
  };
}

/**
 * The microphone signals through the car and the link: noise suppression, gain, then the link of `link` ('nb' or 'wb').
 * `mics` are already mixed (carMic); each gets its own car settings from `random`. Resolves to the clips the page hears.
 * `preroll` samples at the front are processed (so the gates and the gain have settled) and cut off.
 */
export async function throughCar(random, mics, link, { preroll = 0, settings } = {}) {
  const per = mics.map(() => settings ?? carSettings(random));
  const mid = mics.map((m, i) => agc(suppress(random, m, per[i].suppress), RATE, per[i].agc));
  let coded;
  if (link === 'nb') coded = mid.map((m, i) => linkNarrow(m, { upsample: per[i].upsample }));
  else coded = await msbc(mid.map((m) => linkWide(m)));
  return coded.map((c) => c.slice(preroll));
}
