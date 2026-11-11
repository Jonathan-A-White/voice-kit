// The 'Hey Lampas' detector the spike page and its measuring scripts share: a TypeScript port of
// scripts/wake-probe/detector.mjs (route (d) of docs/wake-word-engines.md), with a resampler in front and a compute
// counter beside it. It imports nothing, so a Web Worker, Node and a test run it as it is.
//
//   - the front end: 16 kHz samples to log-mel frames (25 ms Hann window, 10 ms step, 40 bands, 60-7600 Hz), averaged
//     in pairs to 20 ms frames;
//   - the network: a window of those frames (its mean taken off) through small 1-D convolutions to the chance it holds
//     the phrase, its weights read from the model's JSON (public/models/hey-lampas.json);
//   - the rule: a wake when `consecutive` windows in a row reach the threshold, then none for `refractory` seconds, so
//     one saying is one wake;
//   - createResampler: any input rate to 16 kHz; createDetector: input of any rate in, wakes out, compute counted.
//
// tests/detector.test.ts holds the scores to within 0.0001 of detector.mjs on the same audio. Change both together.

export const FRONT_END = Object.freeze({
  rate: 16000,
  win: 400, // samples in one frame (25 ms)
  hop: 160, // samples between frames (10 ms)
  nfft: 512,
  bands: 40,
  fmin: 60,
  fmax: 7600,
  floor: 1e-10,
  pool: 2, // frames averaged into one network frame (20 ms)
});

type FrontEnd = { [K in keyof typeof FRONT_END]: number };

/** A layer of the model's JSON, before its weights are decoded. */
export interface LayerJson {
  type: string;
  in?: number;
  out?: number;
  kernel?: number;
  stride?: number;
  weights?: string;
  bias?: string;
}

/** The model file's JSON (public/models/hey-lampas.json); the fields the detector reads. */
export interface WakeModel {
  kind: string;
  phrase: string;
  frontEnd: FrontEnd;
  window: number;
  step: number;
  scale: number;
  rule: Rule;
  layers: LayerJson[];
  trained?: { date: string; commit: string; parameters: number };
}

export interface Rule {
  /** The score a window must reach. */
  threshold: number;
  /** Windows in a row that must reach it. */
  consecutive: number;
  /** Seconds after a wake in which there is none. */
  refractory: number;
}

interface Layer {
  type: 'conv1d' | 'dense' | 'relu' | 'sigmoid';
  in: number;
  out: number;
  kernel: number;
  stride: number;
  weights: Float32Array;
  bias: Float32Array;
}

/** A model made ready to score. */
export interface Net {
  window: number;
  step: number;
  scale: number;
  rule: Rule;
  layers: Layer[];
  parameters: number;
  model: WakeModel;
}

/** One wake: the audio time (seconds from the first sample) at which the window that woke it was complete, and its score. */
export interface Wake {
  time: number;
  score: number;
  window: number;
}

// ---- the front end ----

const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel: number) => 700 * (10 ** (mel / 2595) - 1);

/** The triangular mel filters, each as its first non-zero bin and its weights from there. */
function makeFilterbank(fe: FrontEnd): { first: number; weights: Float32Array }[] {
  const edges: number[] = [];
  const lo = hzToMel(fe.fmin);
  const hi = hzToMel(fe.fmax);
  for (let i = 0; i < fe.bands + 2; i++) edges.push(melToHz(lo + ((hi - lo) * i) / (fe.bands + 1)));
  const bins = fe.nfft / 2 + 1;
  const filters: { first: number; weights: Float32Array }[] = [];
  for (let b = 0; b < fe.bands; b++) {
    const row = new Float32Array(bins);
    for (let k = 0; k < bins; k++) {
      const hz = (k * fe.rate) / fe.nfft;
      const up = (hz - edges[b]) / (edges[b + 1] - edges[b]);
      const down = (edges[b + 2] - hz) / (edges[b + 2] - edges[b + 1]);
      row[k] = Math.max(0, Math.min(up, down));
    }
    let first = 0;
    while (first < bins && row[first] === 0) first++;
    let last = bins - 1;
    while (last > first && row[last] === 0) last--;
    filters.push({ first, weights: row.slice(first, last + 1) });
  }
  return filters;
}

const FILTERS = makeFilterbank(FRONT_END);
const HANN = Float32Array.from({ length: FRONT_END.win }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRONT_END.win - 1)));

/** In-place radix-2 FFT of re/im (length a power of two). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
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

type FrameMaker = (samples: Float32Array, at: number, out: Float32Array, o: number) => void;

/** Makes a function that turns one frame of `win` samples (from samples[at]) into `bands` log-mel values in out[o..]. */
function frameMaker(): FrameMaker {
  const { win, nfft, bands, floor } = FRONT_END;
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const power = new Float64Array(nfft / 2 + 1);
  return (samples, at, out, o) => {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < win; i++) re[i] = samples[at + i] * HANN[i];
    fft(re, im);
    for (let k = 0; k < power.length; k++) power[k] = re[k] * re[k] + im[k] * im[k];
    for (let b = 0; b < bands; b++) {
      const { first, weights } = FILTERS[b];
      let sum = 0;
      for (let k = 0; k < weights.length; k++) sum += weights[k] * power[first + k];
      out[o + b] = Math.log(sum + floor);
    }
  };
}

// ---- the network ----

function fromBase64(text: string): Float32Array {
  const bytes = atob(text);
  const buf = new ArrayBuffer(bytes.length);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) u8[i] = bytes.charCodeAt(i);
  // float32, little-endian, as the trainer writes them
  const view = new DataView(buf);
  const out = new Float32Array(bytes.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}

/**
 * A model's JSON (the object, not its text) made ready to score: its layers' weights decoded from base64 float32.
 * Throws when the model is not one this detector knows.
 */
export function loadModel(model: WakeModel): Net {
  if (model.kind !== 'voice-kit-wake-cnn') throw new Error(`not a wake model this detector knows: ${model.kind}`);
  const fe = model.frontEnd;
  for (const k of Object.keys(FRONT_END) as (keyof FrontEnd)[]) {
    if (fe[k] !== FRONT_END[k]) throw new Error(`the model's front end has ${k} ${fe[k]}, this detector ${FRONT_END[k]}`);
  }
  const layers = model.layers.map((l): Layer => {
    if (l.type === 'conv1d' || l.type === 'dense') {
      const out = l.out ?? 0;
      const inn = l.in ?? 0;
      const kernel = l.kernel ?? 1;
      const weights = fromBase64(l.weights ?? '');
      const bias = fromBase64(l.bias ?? '');
      const size = l.type === 'conv1d' ? out * inn * kernel : out * inn;
      if (weights.length !== size || bias.length !== out) throw new Error(`layer ${l.type} ${inn}->${out} has the wrong number of weights`);
      return { type: l.type, in: inn, out, kernel, stride: l.stride ?? 1, weights, bias };
    }
    if (l.type === 'relu' || l.type === 'sigmoid') {
      return { type: l.type, in: 0, out: 0, kernel: 0, stride: 1, weights: new Float32Array(0), bias: new Float32Array(0) };
    }
    throw new Error(`unknown layer ${l.type}`);
  });
  const parameters = layers.reduce((n, l) => n + l.weights.length + l.bias.length, 0);
  return { window: model.window, step: model.step, scale: model.scale, rule: { ...model.rule }, layers, parameters, model };
}

function conv1d(l: Layer, x: Float32Array, length: number): { y: Float32Array; length: number } {
  // x: [in][length] channel-major; out: [out][outLength]; out[o][t] = bias[o] + sum_c sum_j w[o][c][j] x[c][t*stride+j]
  const outLength = Math.floor((length - l.kernel) / l.stride) + 1;
  const y = new Float32Array(l.out * outLength);
  const k = l.kernel;
  for (let o = 0; o < l.out; o++) {
    const yo = o * outLength;
    for (let t = 0; t < outLength; t++) y[yo + t] = l.bias[o];
    for (let c = 0; c < l.in; c++) {
      const wo = (o * l.in + c) * k;
      const xc = c * length;
      for (let j = 0; j < k; j++) {
        const w = l.weights[wo + j];
        let xi = xc + j;
        for (let t = 0; t < outLength; t++, xi += l.stride) y[yo + t] += w * x[xi];
      }
    }
  }
  return { y, length: outLength };
}

function dense(l: Layer, x: Float32Array): Float32Array {
  const y = new Float32Array(l.out);
  for (let o = 0; o < l.out; o++) {
    let s = l.bias[o];
    const row = o * l.in;
    for (let i = 0; i < l.in; i++) s += l.weights[row + i] * x[i];
    y[o] = s;
  }
  return y;
}

/**
 * The network's input for one window: `window` network frames (frame-major, bands each) turned channel-major
 * ([band][time]), the window's mean taken off and divided by the model's scale.
 */
function windowInput(net: Net, data: Float32Array, start: number, bands: number): Float32Array {
  const T = net.window;
  const x = new Float32Array(bands * T);
  let mean = 0;
  for (let t = 0; t < T; t++) for (let b = 0; b < bands; b++) mean += data[(start + t) * bands + b];
  mean /= T * bands;
  for (let t = 0; t < T; t++) for (let b = 0; b < bands; b++) x[b * T + t] = (data[(start + t) * bands + b] - mean) / net.scale;
  return x;
}

/** The chance (0 to 1) that one window's input holds the phrase. */
function forward(net: Net, x: Float32Array): number {
  let v = x;
  let length = net.window;
  for (const l of net.layers) {
    if (l.type === 'conv1d') ({ y: v, length } = conv1d(l, v, length));
    else if (l.type === 'dense') v = dense(l, v);
    else if (l.type === 'relu') {
      for (let i = 0; i < v.length; i++) if (v[i] < 0) v[i] = 0;
    } else v = Float32Array.of(1 / (1 + Math.exp(-v[0])));
  }
  return v[0];
}

// ---- the rule, and listening ----

/** Seconds between two windows. */
export function stepSeconds(net: Net): number {
  return (net.step * FRONT_END.pool * FRONT_END.hop) / FRONT_END.rate;
}

/** The time (seconds from the first sample) at which window i of a clip is complete. */
export function windowEnd(net: Net, i: number): number {
  const { win, hop, pool, rate } = FRONT_END;
  const lastRaw = (i * net.step + net.window) * pool - 1;
  return (lastRaw * hop + win) / rate;
}

export interface Listener {
  rule: Rule;
  /** Every window's score, when `keepScores` was set. */
  scores: number[];
  /** Feeds 16 kHz samples in any chunk size; returns the wakes found in that chunk. */
  push(chunk: Float32Array): Wake[];
}

/**
 * A listener fed 16 kHz samples in chunks of any size. push(chunk) returns the wakes it found in that chunk, each with
 * its time (seconds from the first sample, when the window that woke it was complete) and its score. `scores` keeps
 * every window's score when `keepScores` is set (for measuring); `rule` may be changed between pushes.
 */
export function createListener(net: Net, { keepScores = false }: { keepScores?: boolean } = {}): Listener {
  const { win, hop, bands, pool, rate } = FRONT_END;
  const make = frameMaker();
  const step = stepSeconds(net);
  const gap = Math.round(net.rule.refractory / step);
  let pending = new Float32Array(0);
  let consumed = 0; // samples dropped from the front of pending
  let rawFrames = 0;
  const raw = new Float32Array(pool * bands);
  const ring = new Float32Array(net.window * bands); // the last `window` network frames, oldest first
  let netFrames = 0;
  let windowIndex = 0;
  let run = 0;
  let quietUntil = -1;
  const scores: number[] = [];
  const listener: Listener = {
    rule: net.rule,
    scores,
    push(chunk) {
      const all = new Float32Array(pending.length + chunk.length);
      all.set(pending);
      all.set(chunk, pending.length);
      const found: Wake[] = [];
      let at = rawFrames * hop - consumed;
      while (at + win <= all.length) {
        make(all, at, raw, (rawFrames % pool) * bands);
        rawFrames++;
        at += hop;
        if (rawFrames % pool !== 0) continue;
        ring.copyWithin(0, bands);
        const last = (net.window - 1) * bands;
        for (let b = 0; b < bands; b++) {
          let sum = 0;
          for (let p = 0; p < pool; p++) sum += raw[p * bands + b];
          ring[last + b] = sum / pool;
        }
        netFrames++;
        if (netFrames < net.window || (netFrames - net.window) % net.step !== 0) continue;
        const score = forward(net, windowInput(net, ring, 0, bands));
        if (keepScores) scores.push(score);
        run = score >= listener.rule.threshold ? run + 1 : 0;
        if (run === listener.rule.consecutive && windowIndex > quietUntil) {
          found.push({ time: ((rawFrames - 1) * hop + win) / rate, score, window: windowIndex });
          quietUntil = windowIndex + gap;
        }
        windowIndex++;
      }
      const keep = rawFrames * hop - consumed;
      pending = all.slice(Math.min(keep, all.length));
      consumed += Math.min(keep, all.length);
      return found;
    },
  };
  return listener;
}

// ---- the resampler ----

export interface Resampler {
  /** Feeds samples at the input rate in any chunk size; returns the samples now ready at the output rate. */
  push(chunk: Float32Array): Float32Array;
}

const PHASES = 256;
const LOBES = 8;

/**
 * A streaming windowed-sinc resampler, any rate to any rate: a Hann-windowed sinc whose cutoff is 0.45 of the lower
 * rate, so a tone above the new rate's half is filtered out, not folded back. Output n is the input at time n * ratio;
 * it is emitted once the filter's later half has arrived, so the output trails the input by `LOBES` output samples.
 * The result does not depend on how the input was cut.
 */
export function createResampler(inRate: number, outRate: number): Resampler {
  if (inRate === outRate) return { push: (chunk) => chunk };
  const ratio = inRate / outRate; // input samples per output sample
  const cutoff = (0.45 * Math.min(inRate, outRate)) / inRate; // cycles per input sample
  const half = Math.ceil(LOBES / (2 * cutoff)); // taps each side of the centre
  const taps = 2 * half;
  const table = new Float32Array(PHASES * taps);
  for (let p = 0; p < PHASES; p++) {
    let sum = 0;
    for (let j = 0; j < taps; j++) {
      const t = j - half + 1 - p / PHASES; // input sample j's distance from the output instant, in input samples
      const arg = 2 * cutoff * t;
      const sinc = Math.abs(arg) < 1e-12 ? 1 : Math.sin(Math.PI * arg) / (Math.PI * arg);
      const w = Math.abs(t) < half ? 0.5 + 0.5 * Math.cos((Math.PI * t) / half) : 0;
      const v = sinc * w;
      table[p * taps + j] = v;
      sum += v;
    }
    for (let j = 0; j < taps; j++) table[p * taps + j] /= sum; // a constant (DC) passes at gain 1
  }
  let buf = new Float32Array(0);
  let base = 0; // absolute index of buf[0]
  let n = 0; // next output sample
  return {
    push(chunk) {
      const all = new Float32Array(buf.length + chunk.length);
      all.set(buf);
      all.set(chunk, buf.length);
      buf = all;
      const end = base + buf.length; // one past the last input sample held
      const out: number[] = [];
      for (;;) {
        const pos = n * ratio;
        const i0 = Math.floor(pos);
        if (i0 + half >= end) break; // the later half of the filter has not all arrived
        const p = Math.min(PHASES - 1, Math.floor((pos - i0) * PHASES));
        let sum = 0;
        const first = i0 - half + 1;
        for (let j = 0; j < taps; j++) {
          const k = first + j - base;
          if (k >= 0) sum += table[p * taps + j] * buf[k]; // before the first sample the input is silence
        }
        out.push(sum);
        n++;
      }
      const keepFrom = Math.max(0, Math.floor(n * ratio) - half + 1 - base);
      buf = buf.slice(keepFrom);
      base += keepFrom;
      return Float32Array.from(out);
    },
  };
}

// ---- the detector the page and the scripts run ----

export interface DetectorStats {
  /** Milliseconds spent in push() (resampling, features, network). */
  computeMs: number;
  /** Seconds of audio fed to push(), at the input rate. */
  audioSeconds: number;
  /** computeMs per second of audio. */
  msPerSecond: number;
}

export interface Detector {
  /** Feeds samples at the input rate; returns the wakes found, with times in seconds of audio from the first sample. */
  push(chunk: Float32Array): Wake[];
  stats(): DetectorStats;
  /** Every window's score so far, when created with `keepScores`. */
  scores: number[];
}

const now = (): number => globalThis.performance.now();

/**
 * The detector: samples at `inputRate` (16 kHz when not given) in, a Wake out for each saying of the phrase. It counts
 * the time push() takes against the audio it was given, so compute is known per second of audio.
 */
export function createDetector(net: Net, { inputRate = FRONT_END.rate, keepScores = false }: { inputRate?: number; keepScores?: boolean } = {}): Detector {
  const listener = createListener(net, { keepScores });
  const resampler = createResampler(inputRate, FRONT_END.rate);
  let computeMs = 0;
  let audioSamples = 0;
  return {
    scores: listener.scores,
    push(chunk) {
      const started = now();
      const found = listener.push(resampler.push(chunk));
      computeMs += now() - started;
      audioSamples += chunk.length;
      return found;
    },
    stats() {
      const audioSeconds = audioSamples / inputRate;
      return { computeMs, audioSeconds, msPerSecond: audioSeconds > 0 ? computeMs / audioSeconds : 0 };
    },
  };
}
