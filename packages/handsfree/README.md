# @voice-kit/handsfree

The hands-free session: speak to the app without touching it. On the wake word ('Hey Lampas', from
[`voice-kit/wake`](../wake/README.md)) a short soft chime, then it listens until a silence of a set length and hands the words to
the app; after a command the app may ask for a follow-up (the microphone stays open with no wake word); a lower chime when it
closes with nothing heard. Open and close hooks let the app pause its sound while it listens and resume it after.

It is a plain state machine over ports (the wake, the app's listen, the chimes, the page's visibility) and a clock, so every
order of events can be tested on fake time. The session, the router and the tap have no React; the mark and the hooks are in
`voice-kit/handsfree/react`. It imports `voice-kit/wake`, and only types from `voice-kit/composer`:
the listen is the app's, passed in.

<!-- toc -->

- [Install](#install)
- [Use](#use)
- [How an exchange goes](#how-an-exchange-goes)
- [The two microphone ways](#the-two-microphone-ways)
- [Ports](#ports)
- [Hooks](#hooks)
- [Options](#options)
- [States](#states)
- [The spoken-command router](#the-spoken-command-router)
- [The three-finger tap](#the-three-finger-tap)
- [React: the hook, the tap and the mic mark](#react-the-hook-the-tap-and-the-mic-mark)
- [Every end leaves nothing open](#every-end-leaves-nothing-open)
- [The chimes](#the-chimes)
- [Testing](#testing)

<!-- /toc -->

## Install

By pinned commit (there is no registry); the repo's [README](../../README.md#install) names the commit to pin.

```bash
npm install github:Jonathan-A-White/voice-kit#<full commit SHA>
```

## Use

```ts
import { startListening } from 'voice-kit/composer';
import { createBrowserHandsFree } from 'voice-kit/handsfree';

const handsFree = createBrowserHandsFree({
  modelUrl: '/models/hey-lampas.json', // voice-kit/wake/models/hey-lampas.json, served by the app; fetched once
  listen: startListening,
  pauseMs: () => settings.pauseMs, // his 'Pause before it acts' setting, read at each command
  onOpen: () => player.pause(), // at the wake, before any microphone opens
  onCommand: async (words, { followUp }) => {
    const answer = await carryOut(words, followUp); // play, pause, 'read John 3', 'ask ...'
    return { followUp: answer.wasTutorAnswer }; // stay open 8 s for a follow-up after a tutor answer
  },
  onInterrupt: () => (speech.stop(), true), // 'Hey Lampas' over an answer: stop it and take a new command
  onClose: () => player.resumeIfPausedByUs(), // once, when the exchange is over
  onState: (state) => showMicMark(state),
});

await handsFree.start(); // from the Hands-free switch; again from a touch when the state is needs-touch
// ...
handsFree.stop();
```

`createBrowserHandsFree(options)` wires the real ports: the wake is `startWake` from `voice-kit/wake` (the model fetched once from
`modelUrl`, or given as `model`), the chimes are made with WebAudio (`chimes` takes other shapes or another context), and the
document's visibility stops and starts it (`document` to give another). It takes every hook and option below.

`createHandsFree(ports, options)` is the state machine itself, for an app (or a test) that brings its own ports.

## How an exchange goes

1. **The wake.** `onOpen()` is called: the app silences whatever is sounding. Only when it has returned (or its promise settled)
   is the microphone opened for the command.
2. **The microphone opens** (in the [way](#the-two-microphone-ways) `mic` names). When the recogniser says the microphone is open,
   the open chime sounds and the state is `listening`. The chime always means 'speak now'.
3. **The words.** They come by listen's `onInterim`. Once words have come and nothing has changed for `pauseMs` (1500 ms; his
   setting), listening stops and `onCommand(words, { followUp: false })` gets the settled words. No words within `noSpeechMs`
   (6 s) of the chime: the close chime, `onClose`. A command still gaining words at `maxCommandMs` (60 s) is taken as ended there.
4. **The command** (state `working`). `onCommand` resolves when the app has done and said all it will, with `{ followUp: true }`
   or not. While it is pending the wake listens: a wake now calls `onInterrupt()` and opens a new command in the same exchange,
   with the open chime and no second `onOpen`; when `onInterrupt` returns `false` the app has refused: nothing opens and the
   pending command goes on.
5. **The follow-up.** `{ followUp: true }` opens the microphone again with no chime (state `follow-up`). Words within `followUpMs`
   (8 s, counted from the microphone opening) are taken to their own silence and go to `onCommand(words, { followUp: true })`,
   which may ask for another follow-up. No words: the close chime, `onClose`.
6. **The close.** `onClose({ reason })` once, and the wake listens again (state `waiting`).

## The two microphone ways

`mic: 'handover'` (the default): at the wake the wake's microphone stream is closed, and the recogniser opens the microphone
itself, as a hold-to-talk does. While the app works on a command the wake is opened again (so 'Hey Lampas' can interrupt an
answer), and closed again for a follow-up.

`mic: 'share'`: the recogniser is started on a clone of the wake's own track (through listen's `openInput`, the way composer
listens on a Bluetooth input) and the wake keeps running; its wakes are ignored while a command or follow-up listens.

**Why 'handover' is the default.** Whether Android Chrome's speech recogniser can open the microphone while the wake detector
holds a `getUserMedia` stream is not known. 'handover' never asks it to: the stream is closed before the recogniser opens, which
is the path hold-to-talk takes today and works whatever the answer is. Its cost: a short gap in which the wake word is not heard,
and on a car's Bluetooth the sound may switch profile twice. 'share' has neither cost if the phone allows it; only a
try on the phone can say, so it is one option away.

## Ports

`createHandsFree(ports, options)`; the ports object also carries the [hooks](#hooks).

| Port | Shape | What it is |
| --- | --- | --- |
| `wake` | `{ start(onWake): Promise<{ ok: true, track?, stop() } \| { ok: false, kind, message }> }` | The wake word: start it, it calls `onWake` for each wake, stop it. `kind` is `'not-supported'`, `'permission-denied'`, `'no-microphone'`, `'other'` or `'needs-touch'` (the audio will not start without a touch). `browserWake({ model \| modelUrl, ready? })` is this over `startWake`; `ready` resolving `false` gives needs-touch. |
| `listen` | `(options: ListenOptions) => ListenStart` | The app's listen, composer's `startListening` or one of its shape. The session passes `onStart`, `onInterim`, `onError`, `onEnd` and, in 'share', `openInput`; and `listenOptions` (`lang`, `appName`, ...). |
| `chime` | `{ open(): void; close(): void }` | The two chimes. `createChimes()` makes them with WebAudio. Optional: no port, no sound. |
| `visibility` | `{ isHidden(): boolean; onChange(listener): () => void }` | The page's visibility. `documentVisibility(document)` is the real one. Optional. |
| `clock` | `{ setTimeout(fn, ms), clearTimeout(handle) }` | The timers the session's own waits run on. Default: the global ones (so vitest's fake timers move them). |

## Hooks

| Hook | When | What the app does |
| --- | --- | --- |
| `onOpen()` | At the wake, before any microphone opens for the command. May return a promise; the command waits for it. | Pause whatever is sounding (the Bible), so the recogniser does not hear it. |
| `onCommand(words, { followUp })` | The settled words of a command; `followUp` is true for words heard in a follow-up window. | Carry it out and say what it will; resolve `{ followUp: true }` to keep listening with no wake word. A throw or a rejection closes the exchange (`command-failed`). |
| `onInterrupt()` | A wake while `onCommand` is pending. | Stop the answer being spoken and return nothing (or `true`); return `false` to refuse, and the pending command goes on. Not given: every interrupt is taken. |
| `onClose({ reason, kind? })` | Once, when an exchange whose `onOpen` was called is over, whatever ended it. | Resume what `onOpen` paused, unless the command took the sound over. |
| `onState(state)` | Each new state. `subscribe(listener)` does the same and returns how to stop. | Show the mic mark. |

`onOpen` and `onClose` pair exactly once in every path, and `onOpen` always comes before the recogniser starts. The close
`reason` is one of `'done'` (a command done, no follow-up), `'no-speech'`, `'follow-up-ended'`, `'listen-error'`, `'no-open'` (the
recogniser did not open in time), `'command-failed'`, `'wake-error'`, `'stopped'` or `'hidden'`. A close for want of words (`'no-speech'`,
`'follow-up-ended'`, `'no-open'`, `'listen-error'`) also carries `kind`, the kind of the last error the recogniser met in that exchange
(`'no-speech'`, `'network'`, ...), even one `listen` went on through by starting it again; it is absent when the recogniser met none.

## Options

| Option | Default | What it is |
| --- | --- | --- |
| `pauseMs` | 1500 | The silence that ends a command once words have come, in ms. A number, or a function read at each command (his setting can change between commands). |
| `followUpMs` | 8000 | How long a follow-up waits for words, from the microphone opening. |
| `noSpeechMs` | 6000 | How long a command waits for its first words after the chime. |
| `maxCommandMs` | 60000 | A command still gaining words this long after the chime is taken as ended there. |
| `openTimeoutMs` | 3000 | How long the recogniser has to say the microphone is open; then the exchange closes (`no-open`). |
| `mic` | `'handover'` | `'handover'` or `'share'`: [the two microphone ways](#the-two-microphone-ways). |
| `listenOptions` | | Passed to listen as they are: `lang`, `strictLang`, `appName`, `throughPauses`, ... |

The 6 s, 60 s and 8 s, and the chime sounding when the microphone opens rather than at the wake, are the plan's provisional
choices (the Governor to confirm); each is an option.

## States

`state()` returns one of these; `start()` and `stop()` move it, and so do the wake, the words and the page.

| State | What it means |
| --- | --- |
| `{ name: 'off' }` | Nothing listens. `{ name: 'off', hidden: true }`: off only because the page is hidden; it starts again when the page is visible. |
| `starting` | The wake is opening. |
| `waiting` | The wake listens. Also while a wake's `onOpen` runs and the recogniser opens (after an interrupt the state stays `working` then): the state says `listening` only once the chime has sounded. |
| `needs-touch` | The audio will not start until he touches the page (an app opened by Google Assistant). Call `start()` again from the touch. It never pretends to listen. |
| `listening` | The microphone is open for a command (the chime has sounded), or words are coming in a follow-up. |
| `working` | `onCommand` is carrying the words out; the wake listens for an interrupt. |
| `follow-up` | The microphone is open (or opening) for a follow-up, and no words have come yet. |
| `{ name: 'failed', kind, message }` | It cannot run: `kind` is `'permission-denied'` (the microphone was refused), `'not-supported'` (no AudioWorklet or Worker, or no speech recogniser), `'no-microphone'` or `'other'`. It is not tried again by itself; `start()` tries again. |

## The spoken-command router

The words a command heard are not always a command. `route(words, rules)` says which of the app's commands they name, by name and
nothing else: the app maps the name to its own registry, function or screen. It imports no registry and no DOM, and runs in plain
node.

```ts
import { defineSpoken, route } from 'voice-kit/handsfree';

const rules = defineSpoken([
  { name: 'read', phrases: ['read', 'open', 'go to'], rest: true }, // the rest of the words are its argument
  { name: 'pause', phrases: ['pause'] },
  { name: 'play', phrases: ['play', 'resume', 'continue', 'go on'] },
  { name: 'next', phrases: ['next chapter'] },
  { name: 'ask', phrases: ['ask'], rest: true },
]);

route('Read John three, please.', rules); // { name: 'read', rest: 'john 3', words: 'read john 3' }
route('pause', rules); // { name: 'pause', rest: '', words: 'pause' }
route('playground', rules); // undefined: nothing fits, so the app asks the tutor, or says it did not understand
```

- `normaliseSpoken(words)` is applied first, to the words and to each phrase: lower case, punctuation off (a hyphen is a space, an
  apostrophe goes), a leading and a trailing 'please' off, number words as digits ('three' 3, 'twenty one' 21, 'one hundred
  nineteen' 119, 'first' and '1st' 1, 'second' 2, 'third' 3): `'Romans eight verse twenty eight'` is `'romans 8 verse 28'`,
  `'first john two'` is `'1 john 2'`.
- A rule has a `name`, `phrases` (strings, matched on whole words from the start: `'paused'` is not `'pause'`; or patterns, tested
  on the normalised words from the start) and `rest`. With `rest: true` the words after the phrase are the argument; without it,
  extra words mean the rule does not fit.
- The first rule that fits wins, in the order given. The result is `{ name, rest, words }` (`words` are the normalised words), or
  `undefined`.
- This is the simplest thing that fits and is provisional: it is a prefix match over a handful of phrases, not a grammar.

## The three-finger tap

`watchThreeFingerTaps(element, onTap, { skip })` calls `onTap` for each three-finger tap on `element` (the document, usually) and
returns how to stop (every listener is removed).

A real three-finger tap sends one `touchstart` per finger (`touches.length` 1, then 2, then 3), so the fingers are counted as they
land. It is a tap when:

- exactly three fingers were down (a fourth finger, even one that lifts, is no tap);
- none moved more than 10 px (`TAP_MOVE_PX`);
- all were up within 400 ms of the third landing (`TAP_WITHIN_MS`); a slow lift, or a cancelled touch, is no tap.

Some phones send a click after the tap; it is dropped (for 700 ms, `CLICK_DROP_MS`, once). `skip(target)` is given the element a touch
started on, and leaves it alone (a map or a pinch-zoom area with finger gestures of its own). `now` is the clock, `performance.now`
by default, so fake timers move it. For tests, `threeFingerTap(target)` from [`voice-kit/testing/handsfree`](../testing/README.md)
fires the touches.

## React: the hook, the tap and the mic mark

`voice-kit/handsfree/react` (React 18 or later, an optional peer) and `voice-kit/handsfree/styles.css`:

```tsx
import { HandsFreeMark, useHandsFree, useThreeFingerTap } from 'voice-kit/handsfree/react';
import 'voice-kit/handsfree/styles.css';

function Mark() {
  const state = useHandsFree(handsFree); // the session; re-renders on each state
  useThreeFingerTap(() => handsFree.start(), { skip: (t) => t instanceof Element && t.closest('.map') !== null });
  return <HandsFreeMark state={state} label={t('handsFree.' + state.name)} onClick={() => handsFree.start()} />;
}
```

- `useHandsFree(session)`: the session's `state()`, following its `subscribe`. Hold the session in a module or a ref: it must be the
  same each render.
- `useThreeFingerTap(onTap, options)`: `watchThreeFingerTaps` on the document while the component is mounted; the latest `onTap` is
  the one called.
- `<HandsFreeMark state label onClick? className? />`: a small microphone. `state` is the session's state or its name; `label` is
  the accessible name, in the app's words (the mark has no text of its own). Without `onClick` it is a `span` with `role="img"`; with
  it, a `button`. It carries `data-state`, and the stylesheet draws each:

| `data-state` | Look |
| --- | --- |
| `off`, `starting` | muted outline |
| `waiting` | the wake listens: a quiet outline |
| `listening` | the microphone is open: filled green, a gentle pulse that stops under `prefers-reduced-motion` |
| `working` | the app is carrying the words out: blue, dashed |
| `follow-up` | open for a follow-up with no wake word: teal, a thick double line |
| `needs-touch` | amber: touch to start the audio |
| `failed` | red, dotted |

State is never carried by colour alone: the border style differs too. Theme it by CSS variables on `:root`, a parent or
`.bk-handsfree`: `--bk-handsfree-size` (2.25rem), `--bk-handsfree-radius` (999px), `--bk-handsfree-surface`, `--bk-handsfree-off`,
`--bk-handsfree-waiting`, `--bk-handsfree-listening` (#16a34a), `--bk-handsfree-working` (#2563eb), `--bk-handsfree-follow-up`
(#0d9488), `--bk-handsfree-needs-touch` (#d97706), `--bk-handsfree-failed` (#dc2626) and `--bk-handsfree-pulse` (1.4s). Or leave the
file out and style `.bk-handsfree[data-state=...]` yourself.

## Every end leaves nothing open

`stop()`, the page hidden, a recogniser error, a recogniser that does not open in 3 s, `onCommand` throwing, no speech and a
follow-up with no words each end the exchange the same way: the recogniser is aborted, a cloned track is closed, the wake is
stopped (or, if the session goes on, is listening again), and `onClose` is called if `onOpen` was. The close chime sounds when
the exchange closes by itself (no speech, a follow-up with no words, a recogniser error, `no-open`, `command-failed`), not for
`stop()` or a hidden page, and not after a command that was done. A wake, a recogniser or an `onCommand` that answers late, after the exchange it
belonged to has ended or moved on, changes nothing.

## The chimes

`OPEN_CHIME`: two rising sine notes (784 Hz, then 1047 Hz), 220 ms in all, peak gain 0.15. `CLOSE_CHIME`: two falling notes (659
Hz, then 440 Hz), every note lower than every note of open. Made with WebAudio from no file (`playChime(context, shape)`); the
notes never overlap, so the peak is one note's. `createChimes({ context?, readyWaitMs?, open?, close? })` plays them on one
`AudioContext` made when first needed, and its `ready()` says whether audio can sound now: a page with no touch yet has a
suspended context whose `resume()` does not settle, and `ready()` resolves `false` after `readyWaitMs` (300 ms).

## Testing

[`voice-kit/testing/handsfree`](../testing/README.md#wake-word) installs a fake wake that the kit's own `startWake` hands itself to
(no microphone, no model): `say()` is one wake. With `voice-kit/testing/mic`'s recogniser behind composer's `startListening`, a
whole exchange runs on fake timers:

```ts
import { startListening } from 'voice-kit/composer';
import { browserWake, createHandsFree } from 'voice-kit/handsfree';
import { installWake } from 'voice-kit/testing/handsfree';
import { installMic } from 'voice-kit/testing/mic';

vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
vi.stubGlobal('window', globalThis);
const mic = installMic(globalThis); // the recogniser hears 'Please read me the first chapter'
const wake = installWake(globalThis);
const onCommand = vi.fn(async () => ({ followUp: false }));
const hf = createHandsFree({ wake: browserWake({ modelUrl: '/m.json' }), listen: startListening, onCommand });
void hf.start();
await vi.advanceTimersByTimeAsync(200);
wake.say();
await vi.advanceTimersByTimeAsync(8000);
expect(onCommand).toHaveBeenCalledWith('Please read me the first chapter', { followUp: false });
```

The package's own tests (`tests/session.test.ts`) run every path this README names that way.
