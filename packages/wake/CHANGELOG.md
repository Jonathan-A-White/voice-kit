# Changelog: @voice-kit/wake

Newest first. Breaking changes come first in a release, each with its migration in one sentence.

## Unreleased

- Fixed (mw-rl10piw.14): `startWake` no longer hangs on a page that has had no touch, where `AudioContext.resume()` never settles.
  It waits `timeoutMs` (new option, 10 000 ms by default) for the audio context to run and again for the detector to load the
  model, then ends what it started and resolves `{ ok: false, kind: 'other' }`. `startCapture` takes the same limit as its fourth argument.

## 0.1.0 (2026-11-14)

- New (mw-rl10piw.1): the wake word 'Hey Lampas' as a package, `voice-kit/wake`. `startWake(options)` opens the default microphone
  (or takes a stream), loads the model from `model` or `modelUrl`, calls `onWake` for each wake, and resolves `{ ok: true, stop,
  track, ... }` or `{ ok: false, kind, message }` with kind `not-supported`, `permission-denied`, `no-microphone` or `other`. Also
  exported: `loadModel`, `createDetector`, `createListener`, `createResampler`, `startCapture` and their types.
- Lifted from examples/wake-spike (`detector.ts`, `capture.ts`, `worker.ts`, the worklet), which now runs on the package: the same
  model, the same detector, the same numbers (examples/wake-spike/results.json).
- No bundler needed: the worklet and the worker start from `blob:` URLs made from source text (`workletSource.ts`, and
  `workerSource.ts` written by `scripts/embed.mjs`). Detection runs in a Web Worker. A site with a Content-Security-Policy must
  allow `blob:` for workers.
- The model and `licences.json` are packed at `voice-kit/wake/models/*` (copied from examples/wake-spike/public/models by the build).
