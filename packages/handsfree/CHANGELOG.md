# Changelog: @voice-kit/handsfree

Newest first. Breaking changes come first in a release, each with its migration in one sentence.

## 0.2.0 (2026-11-14, not yet tagged)

- New (mw-rl10piw.3): the spoken-command router in `voice-kit/handsfree`: `normaliseSpoken(words)` (lower case, punctuation off, a leading
  and a trailing 'please' off, number words and ordinals as digits), `defineSpoken(rules)` and `route(words, rules)`, which give
  `{ name, rest, words }` for the first rule that fits, or nothing. The app maps the name to its own command; no registry is imported.
- New: `watchThreeFingerTaps(element, onTap, { skip, now })`: a three-finger tap is exactly three fingers, none moved more than 10 px,
  all up within 400 ms of the third landing; the click some phones send after it is dropped; `skip(target)` leaves an element with
  finger gestures of its own alone; it returns how to stop.
- New: `voice-kit/handsfree/react` (React 18 or later, an optional peer): `useHandsFree(session)`, `useThreeFingerTap(onTap, options)` and
  `HandsFreeMark`, a microphone mark that draws the state by `data-state` with the accessible name the app passes in; and
  `voice-kit/handsfree/styles.css`, its look by `--bk-handsfree-*` CSS variables, with a pulse while listening that stops under
  `prefers-reduced-motion`.

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
