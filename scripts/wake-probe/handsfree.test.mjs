// Tests for the hands-free simulation (story mw-rdpwdp1.12): what a car's Bluetooth hands-free microphone does to the
// voice before the page hears it. Network-free; only the mSBC test needs ffmpeg and it is skipped when there is none.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { agc, bandpass, carMic, cvsd, HANDSFREE_CONDITIONS, linkNarrow, linkWide, msbc, resample, suppress, WIDE } from './handsfree.mjs';
import { rng, rms } from './probe.mjs';

const RATE = 16000;
const tone = (hz, seconds, level = 0.2, rate = RATE) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => level * Math.sin((2 * Math.PI * hz * i) / rate));
const white = (random, n, level) => Float32Array.from({ length: n }, () => (random() * 2 - 1) * level * Math.sqrt(3));
const db = (a, b) => 20 * Math.log10(a / b);
// the level of one frequency in a clip (a single DFT bin), middle part only so edges do not count
function levelAt(x, hz, rate = RATE) {
  const from = Math.floor(x.length * 0.25);
  const to = Math.floor(x.length * 0.75);
  let re = 0;
  let im = 0;
  for (let i = from; i < to; i++) {
    re += x[i] * Math.cos((2 * Math.PI * hz * i) / rate);
    im -= x[i] * Math.sin((2 * Math.PI * hz * i) / rate);
  }
  return (2 * Math.hypot(re, im)) / (to - from);
}
const hasFfmpeg = spawnSync(process.env.FFMPEG || 'ffmpeg', ['-version']).status === 0;

test('resample keeps a tone below the new Nyquist, and removes one above it, with the length scaled', () => {
  const x = [...tone(1000, 1), ...tone(1000, 0)];
  const down = resample(Float32Array.from(x), RATE, 8000);
  assert.equal(down.length, 8000);
  assert.ok(Math.abs(db(levelAt(down, 1000, 8000), 0.2)) < 0.5, 'the 1 kHz tone keeps its level');
  const high = resample(tone(6000, 1), RATE, 8000);
  assert.ok(db(levelAt(high, 2000, 8000) + 1e-9, 0.2) < -40 && rms(high) < 0.002, 'a 6 kHz tone does not fold back below 4 kHz');
  const up = resample(down, 8000, RATE);
  assert.equal(up.length, RATE);
});

test('bandpass passes 300-3400 Hz and cuts 100 Hz and 3800 Hz by 20 dB or more', () => {
  const pass = (hz) => db(levelAt(bandpass(tone(hz, 1.2), RATE, 300, 3400), hz), 0.2);
  assert.ok(Math.abs(pass(1000)) < 1, `1 kHz at ${pass(1000)}`);
  assert.ok(Math.abs(pass(500)) < 1.5 && Math.abs(pass(3000)) < 1.5);
  assert.ok(pass(100) < -20, `100 Hz at ${pass(100)} dB`);
  assert.ok(pass(3900) < -20, `3.9 kHz at ${pass(3900)} dB`);
});

test('cvsd (the Bluetooth narrowband codec) follows a speech-band tone with some noise, deterministically, and keeps the length', () => {
  const x = tone(500, 1, 0.2, 8000);
  const y = cvsd(x);
  assert.equal(y.length, x.length);
  assert.deepEqual(cvsd(x), y);
  const diff = Float32Array.from(x, (v, i) => v - y[i]);
  const snr = db(rms(x.subarray(800)), rms(diff.subarray(800)));
  assert.ok(snr > 8 && snr < 60, `SNR ${snr.toFixed(1)} dB: a real codec, not a copy and not a bad one`);
  assert.notDeepEqual(Array.from(y.subarray(1000, 1050)), Array.from(x.subarray(1000, 1050)));
  // a loud 3 kHz tone is too fast for the step size to follow at once: it comes out quieter or distorted, not amplified
  assert.ok(rms(cvsd(tone(3000, 0.5, 0.5, 8000))) < 0.5 * 1.1);
});

test('agc brings a quiet voice up toward a fixed level and a loud one down, and never clips', () => {
  const quiet = agc(tone(400, 4, 0.01), RATE);
  const loud = agc(tone(400, 4, 0.7), RATE);
  const settled = (x) => rms(x.subarray(3 * RATE));
  assert.ok(settled(quiet) > 0.04 && settled(quiet) < 0.2, `quiet settled at ${settled(quiet)}`);
  assert.ok(settled(loud) < 0.3, `loud settled at ${settled(loud)}`);
  assert.ok(Math.max(...quiet.map(Math.abs)) <= 1 && Math.max(...loud.map(Math.abs)) <= 1);
});

test('suppress takes steady noise down by several dB and leaves a voice-like burst mostly there', () => {
  const random = rng(3);
  const n = 4 * RATE;
  const noise = white(random, n, 0.05);
  const mixed = Float32Array.from(noise);
  const burst = tone(700, 1, 0.3);
  for (let i = 0; i < burst.length; i++) mixed[2 * RATE + i] += burst[i] + 0.5 * Math.sin((2 * Math.PI * 1400 * i) / RATE) * 0.1;
  const out = suppress(rng(4), mixed, { floorDb: -18 });
  assert.equal(out.length, mixed.length);
  const before = rms(noise.subarray(RATE, 2 * RATE - 400));
  const after = rms(out.subarray(RATE, 2 * RATE - 400));
  assert.ok(db(before, after) > 6, `noise down by ${db(before, after).toFixed(1)} dB`);
  const burstAfter = levelAt(out.subarray(2 * RATE, 3 * RATE), 700);
  assert.ok(burstAfter > 0.5 * 0.3, `the burst kept ${burstAfter}`);
});

test('carMic mixes road noise and the leaked Bible at the stated levels against the voice', () => {
  const random = rng(5);
  const voice = tone(300, 2, 0.2);
  const road = white(random, 2 * RATE, 1);
  const leak = white(random, 2 * RATE, 1);
  const m = carMic(voice, { road, roadDb: 10, leak: null });
  const noiseOnly = Float32Array.from(m, (v, i) => v - voice[i]);
  assert.ok(Math.abs(db(rms(voice), rms(noiseOnly)) - 10) < 0.2, 'road at 10 dB under the voice');
  const m2 = carMic(voice, { road: null, leak, leakDb: -6 });
  const leakOnly = Float32Array.from(m2, (v, i) => v - voice[i]);
  assert.ok(Math.abs(db(rms(voice), rms(leakOnly)) - -6) < 0.2, 'the Bible 6 dB over the voice (-6 dB under it)');
  assert.deepEqual(carMic(voice, { road: null, leak: null }), voice);
});

test('the conditions: narrowband and wideband, each clean, under road noise at 0 and 10 dB and Bible leak at -10 and 0 dB, and both', () => {
  const keys = HANDSFREE_CONDITIONS.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const link of ['nb', 'wb']) {
    const mine = HANDSFREE_CONDITIONS.filter((c) => c.link === link);
    assert.ok(mine.some((c) => c.road === undefined && c.leak === undefined), `${link}: a clean one`);
    assert.ok(mine.some((c) => c.road === 10) && mine.some((c) => c.road === 0), `${link}: road at 10 and 0 dB`);
    assert.ok(mine.some((c) => c.leak === -10) && mine.some((c) => c.leak === 0), `${link}: Bible at -10 and 0 dB`);
    assert.ok(mine.some((c) => c.road !== undefined && c.leak !== undefined), `${link}: both at once`);
  }
  for (const c of HANDSFREE_CONDITIONS) {
    if (c.road !== undefined) assert.ok(c.road >= 0 && c.road <= 10);
    if (c.leak !== undefined) assert.ok(c.leak >= -10 && c.leak <= 0);
  }
});

test('linkNarrow is call quality: nothing above 3.4 kHz or below 300 Hz, at 16 kHz out, the same length', () => {
  const x = tone(1000, 1.5);
  const y = linkNarrow(x);
  assert.equal(y.length, x.length);
  assert.ok(db(levelAt(y, 1000), 0.2) > -6, 'speech band stays');
  const hi = linkNarrow(tone(5000, 1.5));
  assert.ok(rms(hi) < 0.01, 'a 5 kHz tone is gone');
});

test('linkWide keeps up to about 7 kHz (the wideband speech link)', () => {
  const y = linkWide(tone(5000, 1.5));
  assert.ok(db(levelAt(y, 5000), 0.2) > -4, `5 kHz at ${db(levelAt(y, 5000), 0.2)} dB`);
  assert.ok(WIDE.highpassHz >= 20 && WIDE.highpassHz <= 150);
});

test.skipIf(!hasFfmpeg)('msbc (the Bluetooth wideband codec, through ffmpeg) comes back near the same speech-band signal, a little short or long at most', async () => {
  const x = Float32Array.from({ length: 2 * RATE }, (_, i) => 0.2 * Math.sin((2 * Math.PI * 600 * i) / RATE) + 0.1 * Math.sin((2 * Math.PI * 2100 * i) / RATE));
  const [y] = await msbc([x]);
  assert.ok(Math.abs(y.length - x.length) < 400);
  assert.ok(db(levelAt(y, 600), 0.2) > -3 && db(levelAt(y, 600), 0.2) < 3);
});

test('the tool that is not shipped: the licence list names the codec tools and the simulation is MIT code of ours', () => {
  const list = JSON.parse(readFileSync(new URL('../../examples/wake-spike/public/models/licences.json', import.meta.url), 'utf8'));
  const names = list.entries.map((e) => e.name).join('\n');
  assert.match(names, /handsfree\.mjs/);
  assert.match(names, /FFmpeg/);
  assert.match(names, /Bluetooth/);
});
