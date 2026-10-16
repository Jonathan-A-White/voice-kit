# Changelog: @voice-kit/speech

Newest first. Breaking changes come first in a release, each with its migration in one sentence.

## Moved to voice-kit (2026-10-16)

- Changed (breaking): moved from bsv-kit at b8b2ba303b9397ddb83935f9bde74107903bb074, where this was @bsv-kit/speech 0.1.0. The package is now
  `@voice-kit/speech` and its entry points are `voice-kit/speech`, `voice-kit/speech/react` and `voice-kit/speech/styles.css`; the code is unchanged. Migration: install
  `github:Jonathan-A-White/voice-kit#<full commit SHA>` and change `bsv-kit/speech` to `voice-kit/speech` in each import.
  The `bk-speech__*` class names and `--bk-speech-*` properties keep their names.
- The entries below were written in [bsv-kit](https://github.com/Jonathan-A-White/bsv-kit), whose history before that
  commit is this package's past.

## 0.1.0 (2026-10-09)

- New: the read-aloud engine, lifted from Postern's `src/services/speech.ts` (mw-m7v5kc.1): `speak()` splits a text into sentences, one
  utterance each; `pause()`, `resume()`, `restart()` and `stop()` keep the sentence reached (Postern's mw-q6n8m0.9, since Android Chrome does
  not honour `speechSynthesis.pause()`); a hidden page pauses; `speak(..., { resumeIfPaused })`, `isSpeaking`, `isPausedOn`, `whenDone`,
  `getSpeech` and `subscribe` as Postern's.
- New: the language of every utterance is chosen from the letters of its sentence (Postern's mw-44omaq.7, now Greek, Hebrew and English):
  `utterance.lang` is always set, and `utterance.voice` when the phone lists a voice for the language. Latin letters are read in the `lang`
  option, else the phone's language (`en-US` for a bare `en`).
- New: `bsv-kit/speech/react`: `useSpeaking(key)` (pauses what its screen started when the screen is left, Postern's mw-q6n8m0.10),
  `useSpeech()` and `SpeakingBar` (Pause, Resume, Restart, Stop with Postern's labels, themed through `--bk-speech-*` properties and
  `bk-speech__*` classes in `bsv-kit/speech/styles.css`).
- Changed from Postern: the bead-id and title rewriting of `speechText` and Postern's `TALK_ANSWER_KEY` stay in Postern; an app passes
  its own rewrite as the `prepare` option. A Hebrew voice listed as `iw` matches. `speak()` does nothing, rather than throw, on a phone
  with no speech synthesis. Postern's Latin-letter text is still read in the phone's language.
