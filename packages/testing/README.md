# @voice-kit/testing

Honest fakes for an app's tests, in vitest and in Playwright: a speech synthesiser and a microphone that behave like Android Chrome
**in time**. A fake that records `speak()` and never fires `onend` cannot fail a test about what happens when speech ends; these
fire every event the real ones fire, in order, after the time the real ones take.

It imports nothing from the other voice-kit libraries and needs no DOM library: you hand it the window to put the fakes on.

## Install

By pinned commit (a devDependency for an app); the repo's [README](../../README.md#install) names the commit to pin and has the
npm 11 `allowScripts` note.

```bash
npm install --save-dev github:Jonathan-A-White/voice-kit#<full commit SHA>
```

Then import the subpaths:

| Import                    | What it fakes                                                      |
| ------------------------- | ------------------------------------------------------------------ |
| `voice-kit/testing/speech`  | `speechSynthesis`, `SpeechSynthesisUtterance`                       |
| `voice-kit/testing/mic`     | `navigator.mediaDevices.getUserMedia`, `MediaRecorder`, `SpeechRecognition` and `webkitSpeechRecognition` |
| `voice-kit/testing/talks`   | a grind that answers scripted turns, and a talk store that records (see below)                      |

(The fake Postern backend for grist tests, `bsv-kit/testing`, did not move: it stays in
[bsv-kit](https://github.com/Jonathan-A-White/bsv-kit) with grist.)

## In vitest

Fake the timers, install the fakes on the window (the jsdom `window`, or `globalThis` in a node test), and move time:

```ts
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installSpeech } from 'voice-kit/testing/speech';
import { installMic, clips } from 'voice-kit/testing/mic';

let speech: ReturnType<typeof installSpeech>;
let mic: ReturnType<typeof installMic>;
beforeEach(() => {
  vi.useFakeTimers();
  speech = installSpeech(window); // window.speechSynthesis, window.SpeechSynthesisUtterance
  mic = installMic(window, { clip: clips.greek }); // navigator.mediaDevices, window.MediaRecorder, window.SpeechRecognition
});
afterEach(() => {
  speech.uninstall();
  mic.uninstall();
  vi.useRealTimers();
});

it('Listen plays past the verse', async () => {
  // ... render the app, press Listen ...
  await vi.advanceTimersByTimeAsync(330); // three words: 150 ms and 60 ms a word
  expect(speech.spoken()).toEqual(['In the beginning ...']);
  expect(speech.synth.speaking).toBe(false); // onend fired
});
```

Install the fakes before the app code runs, after `vi.useFakeTimers()`: the fakes read the timers and the clock (`performance.now`, for both the mic and speech) when they are used.
To use another clock, pass `{ clock: { now, setTimeout, clearTimeout } }`.

## In Playwright

`speechInitScript()` and `micInitScript()` return the same fakes as a string for `page.addInitScript`, which runs before the page's
own scripts. The page's own timers move them (real time, or `page.clock`):

```ts
import { test, expect } from '@playwright/test';
import { speechInitScript } from 'voice-kit/testing/speech';
import { micInitScript, clips } from 'voice-kit/testing/mic';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(speechInitScript());
  await page.addInitScript(micInitScript({ clip: clips.english }));
});

test('the recogniser hears the clip', async ({ page }) => {
  await page.goto('/');
  // ... hold the mic button ...
  await expect(page.getByTestId('words')).toHaveText(/Please read me/);
  const spoken = await page.evaluate(() => window.__bsvKitTesting.speech.spoken());
});
```

The handles are on the page as `window.__bsvKitTesting.speech` and `.mic`; for example
`page.evaluate(() => { window.__bsvKitTesting.mic.options.denied = true; })` refuses the permission from then on.
Script options are JSON: everything but `clock`. The handle's name, `__bsvKitTesting`, is historical: these fakes were
`@bsv-kit/testing` before they moved here, and apps' Playwright tests already read it, so it did not change.

## Honest speech

| What                      | How it behaves |
| ------------------------- | -------------- |
| An utterance's time       | `150 + 60 × words` ms, divided by `rate` (options `baseMs`, `msPerWord`) |
| Its events                | `start`, `boundary` (`name: 'word'`, `charIndex`, `charLength`) at each word, `end` |
| `speak()`                 | queues; the next utterance starts when the one before ends; nothing fires inside `speak()` itself |
| `speaking` / `pending`    | `speaking` from `speak()` to `end` (already false inside `onend`); `pending` while queued behind another |
| `pause()` / `resume()`    | hold the current utterance where it is and carry on; `onpause`, `onresume`; `paused` stays true until `resume()` |
| `cancel()`                | the current utterance gets `onerror` `interrupted`, those queued behind it `canceled`; `paused` is left as it was, as the spec says |
| `getVoices()`             | `[]` until `voiceschanged` fires 50 ms after install (`voicesDelayMs`); then `voices` (default an English and a Greek voice) |
| `log`, `spoken()`         | each `speak()`: text, language, rate, voice, `queuedAt`, `startedAt`, `endedAt` (ms since install) and how it went |

## Honest microphone

| What                      | How it behaves |
| ------------------------- | -------------- |
| `getUserMedia`            | answers after 100 ms (`grantMs`) with a stream of one live audio track; rejects `TypeError` for no audio or video, `NotFoundError` for video alone |
| The stream                | plays the clip in real time: `positionMs()`, `playing`, `read(fromMs, toMs)` (16-bit PCM; silence outside the clip); stopping every track ends it |
| `MediaRecorder`           | `start(timeslice)`: a `dataavailable` chunk every slice as it records; `stop()` hands over what is left, then `stop`; with no slice, the whole in one piece on `stop()`. `pause()`, `resume()`, `requestData()`. By default the bytes are the stream's raw PCM, labelled `audio/webm;codecs=opus` (`recorderType`), as Android Chrome reports; no browser decodes them, so an `<audio>` given them errors at once. `recorderType: 'audio/wav'` makes them a real WAV file (44-byte header, then the PCM; the stream's sample rate and channels) that an `<audio>` plays, and `isTypeSupported('audio/wav')` true (it is false by default, as on Chrome). With a timeslice the first chunk's header gives the sizes as unknown (`0xFFFFFFFF`, as a streamed WAV does) and the chunks together are one file of the whole hold |
| `SpeechRecognition`       | opens after 300 ms (`openMs`; Android Chrome takes 200 to 400): `start`, `audiostart`; then `soundstart`, `speechstart`, an interim result at the end of each word (if `interimResults`), `speechend` and one final result at the end of the clip, and `end` 1.5 s later (`silenceMs`) |
| `stop()` / `abort()`      | `stop()` gives the words heard so far as the final result, then ends; `abort()` errors `aborted` and ends; `start()` twice is an `InvalidStateError` |
| `silent: true`            | the input says nothing for 3 s (a number sets the ms, `Infinity` for good): no sound, no result; if nothing comes by `noSpeechMs` (8000) the recogniser errors `no-speech` |
| `denied: true`            | `getUserMedia` rejects with `NotAllowedError`; the recogniser errors `not-allowed`, then ends |
| The clips                 | `clips.english` ("Please read me the first chapter") and `clips.greek` ("Θέλω να ακούσω τον πρώτο ψαλμό"), 16 kHz mono 16-bit WAV, about 2 s each, spoken by eSpeak NG (`scripts/make-clips.mjs`); your own: `{ name, lang, transcript, wavBase64 }` |

The recogniser hears the clip's transcript whatever `lang` it is given, and a recogniser and a stream open at once each play the clip
from their own start (Android Chrome would let only one hold the microphone).

## Credits

The clips are eSpeak NG's speech, resampled with FFmpeg; the Playwright smoke uses playwright-core. See the credits in the
[root README](../../README.md#credits).

## Talks

For a test of an app that keeps talks with `@voice-kit/talks`: no window, no timers, plain objects.

```ts
import { createTalks } from 'voice-kit/talks';
import { createFakeGrind, createFakeTalkStore } from 'voice-kit/testing/talks';

const grind = createFakeGrind(['Grace is a gift.', (request) => `You asked: ${request.message}`, new Error('the grind is down')]);
const store = createFakeTalkStore();
const talks = createTalks({ store, send: grind.send });

const talk = await talks.start();
await talks.ask(talk.id, 'What is grace?'); // answered by the first scripted turn
await talks.ask(talk.id, 'And mercy?'); // the second: a function of the request
await expect(talks.ask(talk.id, 'Again?')).rejects.toThrow('the grind is down'); // the third rejects, and nothing is kept
expect(grind.calls).toHaveLength(3); // every call, with its request and files
expect(store.calls.map((c) => c.method)); // every store call, in order, with its arguments
```

A script that is used up rejects instead of inventing an answer, so a test that asks more than it scripted fails. The fake store
behaves as the real ones do (copies out; a talk that is not there rejects), so a test can read what was kept with `store.get`.
The fake store keeps a turn's `fields` (what an app keeps with a turn: `@voice-kit/talks` 0.8.0) by copy, as the real stores do, and
`createFakeTalkStore<Mine>()` types them.
The fakes meet the `TalkStore` and `send` shapes by their structure, so this package still imports nothing from `@voice-kit/talks`.
