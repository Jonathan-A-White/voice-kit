# @voice-kit/speech

Postern's read-aloud engine, for every app that speaks. A text is spoken **a sentence at a time**, one utterance each, and the
engine keeps the place: **Pause** keeps the sentence reached, **Resume** speaks on from it, **Restart** goes back to the
first, **Stop** clears. A page that goes hidden pauses what it is saying, and a screen that is left pauses what it started;
coming back offers Resume at the same place. Every utterance names its **language** and, when the phone lists one, a
**voice** for it, chosen from the text's letters: Greek, Hebrew, or the app's language for Latin letters.

It is two entries. `voice-kit/speech` is the engine, with no framework. `voice-kit/speech/react` is a hook and the one
**SpeakingBar** (React 18 or later: `react` is an optional peer, so an app that only wants the engine needs none). It
imports nothing from the other voice-kit libraries. It keeps no storage and reaches no network: the text is spoken locally by the
phone's own `speechSynthesis`.

## Install

By pinned commit (there is no registry); the repo's [README](../../README.md#install) names the commit to pin and has the npm 11
`allowScripts` note.

```bash
npm install github:Jonathan-A-White/voice-kit#<full commit SHA>
```

## Use

```tsx
import { speak, stop } from 'voice-kit/speech';
import { SpeakingBar, useSpeaking } from 'voice-kit/speech/react';
import 'voice-kit/speech/styles.css';

function ReadAloud({ text }: { text: string }) {
  const speaking = useSpeaking('article'); // is the speech started under this key the one speaking? (pauses it when this screen is left)
  return <button onClick={() => (speaking ? stop() : speak(text, { key: 'article' }))}>{speaking ? 'Stop' : 'Read aloud'}</button>;
}

function App() {
  return (
    <>
      <ReadAloud text="First sentence. Second sentence." />
      <SpeakingBar /> {/* Pause / Resume, Restart, Stop: shown while something speaks or waits paused */}
    </>
  );
}
```

Call `speak()` from the tap's own handler: Android Chrome refuses speech started later.

## The engine (`voice-kit/speech`)

| Function | What it does |
| -------- | ------------ |
| `speak(text, options?)` | Cancels any speech, then speaks `text`. Options: `key` (who started it), `onEnd`, `resumeIfPaused` (carry on from the kept sentence if this key and text were paused), `lang` (what Latin-letter text is read in; default the phone's language, `en-US` for a bare `en`), `prepare(text)` (the app's own rewrite before speaking, say its ids into words). A bare URL is not read aloud. Does nothing when the phone cannot speak: check `isSupported()`. |
| `pause()`, `resume()`, `restart()`, `stop()` | Steer the speech. `pause()` cancels the queue and keeps the sentence (Android Chrome does not honour `speechSynthesis.pause()`); `resume()` queues the sentences from the kept one. |
| `getSpeech()`, `subscribe(fn)` | `{ status: 'idle' \| 'playing' \| 'paused', key, index, count }`, the same object until it changes; `useSyncExternalStore`-ready. |
| `isSpeaking(key)`, `isPausedOn(key, text)`, `whenDone(key, fn)` | Whose speech it is (a paused one still is), whether a screen coming back can offer Resume, and what to run when it is over for good. |
| `languageOf(text)`, `scriptOf(text)`, `readingLang()` | The language tag a text is read in, from its letters (`el-GR`, `he-IL`, else the app's or the phone's), the script most of its letters are in, and the phone's language as a full tag. |

The language is chosen **for each sentence**: a text that quotes a Greek word in an English sentence stays English; a sentence of
Greek letters is read as `el-GR`; one with no letters ('42.') takes the language of the text around it. A voice is chosen
for the language (an exact tag, else one of the same language; `iw` is read as `he`), and an utterance with no matching voice gets
its language alone. The first speak waits up to a second for the phone to list its voices.

## The bar and the hook (`voice-kit/speech/react`)

- `useSpeaking(key)` is true while the speech started under `key` reads or waits paused. When the component that used it unmounts (the
  screen is left), the speech it started is paused, not stopped; another speaker's speech is not touched.
- `useSpeech()` is the whole `getSpeech()` state, for a component that shows the sentence reached.
- `<SpeakingBar />` shows nothing while idle, else **Pause** (**Resume** while paused), **Restart** and **Stop**, each at least 44 px high,
  in flow and never over text. Props: `except` (show it for every speech but the one under this key, for a screen that draws its own
  buttons), `labels` (`region`, `pause`, `resume`, `restart`, `stop`; `DEFAULT_LABELS` are Postern's) and `className`.

## The look

Styling is class names and CSS custom properties only. `styles.css` (import it once) gives a plain default look and reads every colour
and size from a `--bk-speech-*` property with a default, so an app themes it by setting the properties on `:root`, a parent or
`.bk-speech`:

```css
:root {
  --bk-speech-accent: #0f766e;     /* the Resume button */
  --bk-speech-accent-fg: #ffffff;
  --bk-speech-surface: #fffdf7;    /* the bar */
  --bk-speech-button-size: 3rem;   /* button height; never below 44 px (2.75rem) */
}
```

The full list is at the top of `styles.css`. Or leave the file out and style the classes: `bk-speech` (`data-state` 'playing' or 'paused'),
`bk-speech__button` (`data-action` 'pause', 'resume', 'restart' or 'stop'; `data-primary` on Resume) and `bk-speech__icon`.

The class names and properties begin `bk-` for historical reasons: speech was `@bsv-kit/speech` before it moved
here, and apps already theme these names, so they did not change.

## Testing an app that speaks

Use `voice-kit/testing/speech`: an honest `speechSynthesis` that queues, starts an utterance after `speak()`, fires start, word boundaries and end in the time
the words take, and reports a cancelled one as an error, as Android Chrome does. This package's own tests run against it.
