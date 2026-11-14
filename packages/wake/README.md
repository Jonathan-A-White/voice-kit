# @voice-kit/wake

The wake word 'Hey Lampas' in the browser. A small detector (a log-mel front end, a 1-D convolutional network and a rule that
turns scores into one wake), the microphone tap that feeds it (an AudioWorklet) and the Web Worker that runs it, with the trained
model packed beside them. `startWake()` opens the microphone and calls you for each wake.

No React, no dependency, no bundler needed: the worklet and the worker start from `blob:` URLs made from source text the package
carries, and detection runs in the worker, never on the page's main thread. This is the wake word as the spike
([examples/wake-spike](../../examples/wake-spike/README.md)) has it: the same model, the same detector, the same numbers.

## Install

By pinned commit (there is no registry); the repo's [README](../../README.md#install) names the commit to pin and has the npm 11
`allowScripts` note.

```bash
npm install github:Jonathan-A-White/voice-kit#<full commit SHA>
```

## Use

```ts
import { startWake } from 'voice-kit/wake';
// the model is a plain file the build packs; serve it from your site (copy it to public/) or import it as JSON:
import model from 'voice-kit/wake/models/hey-lampas.json' with { type: 'json' };

const wake = await startWake({ model, onWake: (w) => console.log('Hey Lampas', w.time, w.score) });
if (!wake.ok) {
  // wake.kind: 'not-supported' | 'permission-denied' | 'no-microphone' | 'other'; wake.message says it in a sentence
} else {
  // ... later
  wake.stop(); // ends the worker, the audio context and the microphone track
}
```

`startWake(options)` opens the default microphone itself (`getUserMedia({ audio: true })`, the browser's own settings: echo
cancellation and noise suppression as the browser defaults them) unless you give it a `stream`; then it leaves the stream's
tracks to you. The model is `options.model` (the parsed JSON) or `options.modelUrl` (fetched). It resolves with
`{ ok: true, stop, track, stream, inputRate, model }` or `{ ok: false, kind, message }`; it does not throw for a failure a user
can cause. Also `onStats` (what the detector has cost, about once per second of audio), `onInput` (each batch of samples as the
browser captured them) and `onError` (a failure after the start).

The parts are exported too: `loadModel`, `createDetector` (samples of any rate in, wakes out, compute counted),
`createListener`, `createResampler` and `startCapture(stream, model, handlers)`. The detector imports nothing, so Node runs it
as it is on 16 kHz samples.

## The model and its licences

The model is `hey-lampas.json` (470 KB, 347 KB gzipped), packed at `voice-kit/wake/models/hey-lampas.json` with
`licences.json` beside it. It stays where the trainer writes it, `examples/wake-spike/public/models/`; the build copies every
`.json` there into `packages/wake/dist/models/`. The weights are ours (MIT), made by `scripts/wake-probe` from data under
other licences. **An app that ships the model must credit what `licences.json` lists as used**: each entry names the dataset or
tool, its licence and the licence's own words.

## What it does, measured

Headless, on the laptop, 2026-11-12 ([examples/wake-spike/results.json](../../examples/wake-spike/results.json); the README
there says how each is measured). The bar is the Governor's: at most 1 false wake an hour while the Bible plays, at most 2
misses in 20 tries.

- False wakes while the Bible played: 0 in 62.0 min (0.00 an hour). Through a car's narrowband hands-free link: 0.97 an hour
  (1 in 62.0 min); wideband: 0.00.
- Misses in 20 tries of 'Hey Lampas': 0 clean, 0 under Bible audio at 10 dB and at 0 dB, 0 under brown noise at 5 dB.
- Through a car's hands-free microphone: 0 in 20 clean and under road noise, narrowband or wideband; with the Bible leaking back
  into the microphone, wideband at 0 dB 1 in 20 and at -10 dB 9 in 20, narrowband 4 in 20 at 0 dB and 8 in 20 at -10 dB (not met).
- Delay from the end of the phrase to the wake: 83 ms median, 327 ms worst.
- Compute: 80.94 ms per second of audio in Node, 109.70 in Chromium, 431.65 in Chromium with the CPU throttled 4x (a phone
  proxy). Battery is not measured: it needs a phone.

## Two accepted limits

- **The car's sound drops toward call quality while the microphone is open.** A Bluetooth car that is asked for a microphone
  switches from its music profile to its hands-free (call) profile, so what you hear from the car sounds like a phone call for as
  long as the microphone is open.
- **It misses more when other speech is loud.** With the Bible playing at the same level as the voice, or louder, through a car's
  microphone, it misses more tries (the numbers above).

## Content-Security-Policy

The worklet and the worker are started from `blob:` URLs, so a site with a Content-Security-Policy must allow `blob:` for
workers (`worker-src blob:`, and for the worklet module `script-src blob:`, or `default-src` with `blob:`). Without it the
browser refuses to start them and `startWake` resolves `{ ok: false, kind: 'other' }`.

## Develop

`npm run build --workspace packages/wake` (the root `npm run build` does it too). `scripts/embed.mjs` writes
`src/workerSource.ts`, the worker as text (the detector and the worker's code transpiled and joined: a worker started from a
`blob:` URL cannot import its neighbour), before `tsc`, and copies the models into `dist/models` after it. The text is committed
and `tests/wake.test.ts` holds it equal to what the script makes. `tests/built.test.ts` loads the built `dist` in Chromium as plain
modules with a fake microphone saying the phrase.
