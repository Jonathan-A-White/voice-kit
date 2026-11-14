# Changelog: @voice-kit/handsfree

Newest first. Breaking changes come first in a release, each with its migration in one sentence.

## 0.1.0 (2026-11-14)

- New (mw-rl10piw.2): the hands-free session as a package, `voice-kit/handsfree`. `createHandsFree(ports, options)` is a state
  machine over injected ports (`wake`, `listen`, `chime`, `visibility`, `clock`) and hooks (`onOpen`, `onCommand`, `onInterrupt`,
  `onClose`, `onState`), with `start()`, `stop()`, `state()` and `subscribe()`. States: `off`, `starting`, `waiting`, `needs-touch`,
  `listening`, `working`, `follow-up`, `failed` (with its kind).
- The exchange: a wake; `onOpen` before any microphone opens; the open chime when the recogniser says the microphone is open; the
  words until `pauseMs` of no change (1500 ms, or a function read at each command); `onCommand`; a follow-up window of `followUpMs`
  (8 s) with no chime when the app asks; the lower close chime when nothing is heard (`noSpeechMs`, 6 s, after the chime; or the
  follow-up window); `onClose` once. A command is cut at `maxCommandMs` (60 s). A wake while `onCommand` is pending calls
  `onInterrupt` and opens a new command in the same exchange unless it returns false.
- Two microphone ways: `mic: 'handover'` (the default: the wake's stream is closed before the recogniser opens the microphone) and
  `'share'` (the recogniser listens on a clone of the wake's track, the wake running on).
- Every end (stop, the page hidden, a recogniser error, a recogniser that does not open in 3 s, `onCommand` throwing) leaves no
  recogniser and no microphone track open, and calls `onClose` if `onOpen` was. A refused microphone is `failed 'permission-denied'`,
  never retried by itself; audio that needs a touch is `needs-touch`, and `start()` from the touch goes on.
- `createChimes()`, `playChime()`, `OPEN_CHIME` (two rising notes, 220 ms, peak 0.15) and `CLOSE_CHIME` (lower): WebAudio, no file.
- `createBrowserHandsFree(options)`: the real ports in one call (`browserWake` over `startWake` with the model fetched once, the
  chimes, `documentVisibility(document)`), around the app's `listen`.
