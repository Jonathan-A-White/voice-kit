# Changelog: @voice-kit/testing

Newest first. Breaking changes come first in a release, each with its migration in one sentence.

## 0.4.1 (2026-10-23, not yet tagged)

- Fixed (mw-k4sekr.1): the fake speech's default clock is `performance.now` (`Date.now` only where there is no `performance`), as the fake mic's
  is: when the host's wall clock stepped back during an utterance, pausing it measured a negative stretch, so it ran on far too long (its
  `end` event never came in time) and the log's `endedAt` read negative.

## 0.4.0 (2026-10-23, not yet tagged)

- New (mw-o480n1.3): the fake talk store keeps a turn's `fields` (what an app keeps with a turn) by copy, as the in-memory and Dexie
  stores of `@voice-kit/talks` 0.8.0 do; `FakeTurn<F>`, `FakeTalk<F>`, `FakeTalkSummary<F>`, `FakeTalkStore<F>` and
  `createFakeTalkStore<F>()` carry the type, `F` defaulting to `Record<string, unknown>`. Additive.
- Fixed (mw-o480n1.11): the fake mic's default clock is `performance.now`, not `Date.now`: when the host's wall clock stepped back during a
  recording the hold read negative, the recording was empty and an `<audio>` element read its WAV's duration as Infinity.

## 0.3.1 (2026-10-23, not yet tagged)

- Changed (mw-t3xu9a.2): the fake talk store keeps the tutor record's new kinds, `'turn'` and `'weights'` (with `names`), for
  `@voice-kit/talks` 0.4.0. Additive.

## 0.3.0 (2026-10-23, not yet tagged)

- New (mw-t3xu9a.1): `createFakeTalkStore()` is also a `TutorStore` for the tutor client of `@voice-kit/talks` 0.3.0: each
  screen's up-front list (`upFront`, `setUpFront`) and the tutor record (`note`, `record(screen?)`), with its calls recorded as the
  others are. It passes the same store contract as the in-memory and Dexie stores. Additive.

## 0.2.0 (2026-10-22, not yet tagged)

- New (mw-79en7t.31): `voice-kit/testing/talks`, also exported from the package index: `createFakeGrind(script)`, a grind for
  `createTalks` that answers the scripted turns in order (a value, a function of the request, or an `Error` to reject with),
  records each call, and rejects when its script is used up; and `createFakeTalkStore()`, an in-memory `TalkStore` that records
  every call (`calls`). Additive: the speech and mic fakes are unchanged. Like the rest of the package it imports nothing.

## Moved to voice-kit (2026-10-16)

- Changed (breaking): moved from bsv-kit at b8b2ba303b9397ddb83935f9bde74107903bb074, where this was @bsv-kit/testing 0.1.0 with the unreleased recorder change below. The package is now
  `@voice-kit/testing` and its entry points are `voice-kit/testing/speech` and `voice-kit/testing/mic`; the code is unchanged. Migration: install
  `github:Jonathan-A-White/voice-kit#<full commit SHA>` and change `bsv-kit/testing` to `voice-kit/testing` in each import.
  The page handle `window.__bsvKitTesting` keeps its name.
- The entries below were written in [bsv-kit](https://github.com/Jonathan-A-White/bsv-kit), whose history before that
  commit is this package's past.

## Unreleased in bsv-kit (moved with the package)

- New: `installMic({ recorderType: 'audio/wav' })` (and `micInitScript`) makes the recorder's bytes a real WAV file, labelled `audio/wav`, which an `<audio>` element plays; `MediaRecorder.isTypeSupported('audio/wav')` is then true. The default is unchanged: raw PCM labelled `audio/webm;codecs=opus`, which Chromium cannot decode (mw-f1m3sd).

## 0.1.0 (2026-10-09)

- New: `bsv-kit/testing/speech`: an honest `speechSynthesis` and `SpeechSynthesisUtterance` (mw-it6qk5.2). `speak()` queues; each
  utterance takes 150 ms and 60 ms a word, divided by its rate, on a clock the test can fake, and fires `start`, a `boundary` for each
  word (`charIndex`, `charLength`), then `end`. `pause()` holds the current utterance and `resume()` carries on; `cancel()` ends the
  current one with error `interrupted` and drops the queue with `canceled`. `getVoices()` is empty until `voiceschanged` fires 50 ms
  after install. A log says what was spoken and when. `installSpeech(window)` for vitest; `speechInitScript()` for Playwright's
  `page.addInitScript`.
- New: `bsv-kit/testing/mic`: an honest microphone. `getUserMedia` answers after 100 ms with a stream that plays a WAV clip in real
  time (an English and a Greek clip, spoken by eSpeak NG, are committed: `clips.english`, `clips.greek`); `MediaRecorder` hands over
  chunks as it records and what is left on `stop()`; `SpeechRecognition` (and `webkitSpeechRecognition`) opens after 300 ms, sends
  interim results word by word as the clip plays and a final one at its end, and ends 1.5 s later. Options: a `silent` input (nothing
  for 3 s, as a Bluetooth headset can be), a `denied` permission (`NotAllowedError`). `installMic(window)` for vitest;
  `micInitScript()` for Playwright.
- Not changed: `bsv-kit/testing` stays the grist tests' fake Postern (`fakePostern`); the new fakes are its two subpaths.
