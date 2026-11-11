// The 'Hey Lampas' detector of route (d) in docs/wake-word-engines.md: the scoring code, in one module, plain
// JavaScript with no import at all, so it runs as is in Node, a Web Worker or an AudioWorklet.
//
//   - the front end: 16 kHz samples to log-mel frames (25 ms Hann window, 10 ms step, 40 bands, 60-7600 Hz),
//     averaged in pairs to 20 ms frames;
//   - the network: a window of those frames (its mean taken off) through small 1-D convolutions to the chance it
//     holds the phrase, its weights read from the model's JSON (examples/wake-spike/public/models/hey-lampas.json);
//   - the rule: a wake when `consecutive` windows in a row reach the threshold, then none for `refractory` seconds.
//
// scripts/wake-probe/probe.mjs scores everything through this module. Story mw-rdpwdp1.3 ports it to the page and
// checks the port against it.

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

/** Frames logMel makes from n samples: one per 10 ms once the first 25 ms are in. */
export function frameCount(n, fe = FRONT_END) {
  return n < fe.win ? 0 : 1 + Math.floor((n - fe.win) / fe.hop);
}

const hzToMel = (hz) => 2595 * Math.log10(1 + hz / 700);
const melToHz = (mel) => 700 * (10 ** (mel / 2595) - 1);

/** The triangular mel filters, each as its first non-zero bin and its weights from there. */
function makeFilterbank(fe) {
  const edges = [];
  const lo = hzToMel(fe.fmin);
  const hi = hzToMel(fe.fmax);
  for (let i = 0; i < fe.bands + 2; i++) edges.push(melToHz(lo + ((hi - lo) * i) / (fe.bands + 1)));
  const bins = fe.nfft / 2 + 1;
  const filters = [];
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
  return { filters, centres: edges.slice(1, -1).map((hz) => Math.round(hz)) };
}

const FILTERS = makeFilterbank(FRONT_END);
const HANN = Float32Array.from({ length: FRONT_END.win }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRONT_END.win - 1)));

/** In-place radix-2 FFT of re/im (length a power of two). */
export function fft(re, im) {
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

/** Makes a function that turns one frame of `win` samples (from samples[at]) into `bands` log-mel values in out[o..]. */
function frameMaker() {
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
      const { first, weights } = FILTERS.filters[b];
      let sum = 0;
      for (let k = 0; k < weights.length; k++) sum += weights[k] * power[first + k];
      out[o + b] = Math.log(sum + floor);
    }
  };
}

/** Log-mel frames of 16 kHz samples in [-1, 1]: { frames, bands, data (frame-major), centres (Hz) }. */
export function logMel(samples) {
  const { hop, bands } = FRONT_END;
  const frames = frameCount(samples.length);
  const data = new Float32Array(frames * bands);
  const make = frameMaker();
  for (let f = 0; f < frames; f++) make(samples, f * hop, data, f * bands);
  return { frames, bands, data, centres: FILTERS.centres };
}

/** Log-mel frames averaged in groups of `pool` (a last, short group is dropped): { frames, bands, data }. */
export function poolFrames(mel, pool = FRONT_END.pool) {
  const { bands } = mel;
  const frames = Math.floor(mel.frames / pool);
  const data = new Float32Array(frames * bands);
  for (let f = 0; f < frames; f++) {
    for (let b = 0; b < bands; b++) {
      let sum = 0;
      for (let p = 0; p < pool; p++) sum += mel.data[(f * pool + p) * bands + b];
      data[f * bands + b] = sum / pool;
    }
  }
  return { frames, bands, data };
}

/** The network frames of 16 kHz samples: logMel, then poolFrames. */
export function features(samples) {
  return poolFrames(logMel(samples));
}

/** Samples a window of `frames` network frames covers. */
export function windowSamples(frames, fe = FRONT_END) {
  return fe.win + fe.hop * (frames * fe.pool - 1);
}

// ---- the network ----

function fromBase64(text) {
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
export function loadModel(model) {
  if (model.kind !== 'voice-kit-wake-cnn') throw new Error(`not a wake model this detector knows: ${model.kind}`);
  const fe = model.frontEnd;
  for (const k of Object.keys(FRONT_END)) {
    if (fe[k] !== FRONT_END[k]) throw new Error(`the model's front end has ${k} ${fe[k]}, this detector ${FRONT_END[k]}`);
  }
  const layers = model.layers.map((l) => {
    if (l.type === 'conv1d' || l.type === 'dense') {
      const weights = fromBase64(l.weights);
      const bias = fromBase64(l.bias);
      const size = l.type === 'conv1d' ? l.out * l.in * l.kernel : l.out * l.in;
      if (weights.length !== size || bias.length !== l.out) throw new Error(`layer ${l.type} ${l.in}->${l.out} has the wrong number of weights`);
      return { ...l, weights, bias };
    }
    if (l.type === 'relu' || l.type === 'sigmoid') return { ...l };
    throw new Error(`unknown layer ${l.type}`);
  });
  const parameters = layers.reduce((n, l) => n + (l.weights ? l.weights.length + l.bias.length : 0), 0);
  return { window: model.window, step: model.step, scale: model.scale, rule: { ...model.rule }, layers, parameters, model };
}

function conv1d(l, x, length) {
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

function dense(l, x) {
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
 * The network's input for one window: `frames` network frames (frame-major, bands each) turned channel-major
 * ([band][time]), the window's mean taken off and divided by the model's scale.
 */
export function windowInput(net, data, start, bands = FRONT_END.bands) {
  const T = net.window;
  const x = new Float32Array(bands * T);
  let mean = 0;
  for (let t = 0; t < T; t++) for (let b = 0; b < bands; b++) mean += data[(start + t) * bands + b];
  mean /= T * bands;
  for (let t = 0; t < T; t++) for (let b = 0; b < bands; b++) x[b * T + t] = (data[(start + t) * bands + b] - mean) / net.scale;
  return x;
}

/** The chance (0 to 1) that one window's input holds the phrase. */
export function forward(net, x) {
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

/**
 * The rule over a run of scores, one per window: a wake at the window where `consecutive` scores in a row have reached
 * `threshold`, then no wake for `refractory` seconds; one run of high scores wakes once at most. Returns the windows'
 * indices of the wakes.
 */
export function wakes(scores, rule, stepSeconds) {
  const out = [];
  const gap = Math.round(rule.refractory / stepSeconds);
  let run = 0;
  let quietUntil = -1;
  for (let i = 0; i < scores.length; i++) {
    run = scores[i] >= rule.threshold ? run + 1 : 0;
    if (run === rule.consecutive && i > quietUntil) {
      out.push(i);
      quietUntil = i + gap;
    }
  }
  return out;
}

/** Seconds between two windows. */
export function stepSeconds(net) {
  return (net.step * FRONT_END.pool * FRONT_END.hop) / FRONT_END.rate;
}

/**
 * A listener fed 16 kHz samples in chunks of any size. push(chunk) returns the wakes it found in that chunk, each as
 * { time } (seconds from the first sample, when the window that woke it was complete) and { score }. `scores` keeps
 * every window's score when `keepScores` is set (for measuring); `rule` may be changed between pushes.
 */
export function createListener(net, { keepScores = false } = {}) {
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
  const scores = [];
  const listener = {
    rule: net.rule,
    scores,
    push(chunk) {
      const all = new Float32Array(pending.length + chunk.length);
      all.set(pending);
      all.set(chunk, pending.length);
      const found = [];
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

/** The time (seconds from the first sample) at which window i of a clip is complete. */
export function windowEnd(net, i) {
  const { win, hop, pool, rate } = FRONT_END;
  const lastRaw = (i * net.step + net.window) * pool - 1;
  return (lastRaw * hop + win) / rate;
}

/** Every window's score of a whole clip, through the same listener the page runs. */
export function scoreClip(net, samples) {
  const listener = createListener(net, { keepScores: true });
  listener.push(samples);
  return listener.scores;
}

/** The wakes of a whole clip under the model's rule, as { time, score, window }. */
export function listen(net, samples) {
  return createListener(net).push(samples);
}
