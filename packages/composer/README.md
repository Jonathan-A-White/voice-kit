# @voice-kit/composer

Postern's message composer as a React component. Hold the big bar and talk: the words show as they are heard,
letting go sends them, and sliding off the bar first keeps them in the box, unsent. Attach and camera sit quietly
below the bar, with 'Type a message' to type instead. An app can open it speak-first (the bar) or type-first
(the text box and Send, with a small mic). It needs React 18 or later (`react` and `react-dom`, peer
dependencies) and imports nothing from the other voice-kit libraries.

## Install

By pinned commit (there is no registry); the repo's [README](../../README.md#install) names the commit to pin and has the npm 11
`allowScripts` note.

```bash
npm install github:Jonathan-A-White/voice-kit#<full commit SHA>
```

## Use

```tsx
import { createRoot } from 'react-dom/client';
import { Composer } from 'voice-kit/composer';
import 'voice-kit/composer/styles.css';

function App() {
  return (
    <Composer
      mode="speak" // or "type": the text box and Send first
      attach
      camera
      labels={{ hold: 'Hold to ask', typeInstead: 'Type a question', placeholder: 'Type a question' }}
      onSend={async ({ text, files }) => {
        const response = await fetch('/api/ask', { method: 'POST', body: JSON.stringify({ text, names: files.map((f) => f.name) }) });
        return response.ok; // false: the words stay in the box, unsent
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(<App />);
```

## What the app passes

| Prop           | What it does                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `onSend`       | Gets `{ text, files }` (each file `{ name, type, bytes, durationMs? }`). Return or resolve `false`, or throw, when it did not go: the words wait in the box. A thrown `Error`'s message is shown. |
| `mode`         | `'speak'` (default): the hold bar first. `'type'`: the text box and Send first, with a small mic that brings the bar out. |
| `transcriber`  | How audio becomes text. Default `browserSpeech` (the browser's SpeechRecognition, as Postern does: words as he speaks). `transcribeRecording(fn)` records the hold and calls `fn(recording)` on release for the words (your own speech-to-text service). |
| `attach`, `camera` | Show the attach (any file; paste and drop too) and camera buttons. Both hidden when not given. |
| `recordVoice`  | Send each hold's voice as a voice note beside the words (with `browserSpeech`; `transcribeRecording` already has the recording). |
| `labels`       | Any of the words on the screen (`DEFAULT_LABELS`): `hold` 'Hold to talk', `tryAgain` 'Try again' (the bar after a hold that ended with a notice), `typeInstead` and `placeholder` 'Type a message', `release`, `drop`, `kept`, `send`, `speak`, `attach`, `camera`, ... |
| `refuseFile`   | `(file) => reason or undefined`: a refused file is not added and the reason is shown.            |
| `onNotice`     | Takes what the composer would say about a refused file or a failed send (to show it as a toast). |
| `lang`, `appName` | The language to listen for (default the page's `<html lang>`), and the app's name in "the microphone is not allowed for ..." |
| `initialText`, `autoFocus`, `disabled`, `top`, `className` | Words already in the box; focus on open; nothing can be held or sent; a node at the top (a quote); a class on the root. |

Send with nothing said: attach a picture (or any file) and leave the box empty, and a Send arrow stands beside Hold to talk.
One tap sends the attachments with no words (`onSend` gets `{ text: '', files }`), so a picture needs no comment. Hold to talk
stays the big button, with the same height and place (it gives up only the arrow's width); with nothing attached nothing
changes, and once words are typed the text box's own Send is the one. The arrow waits while the bar is held. The example page,
`examples/composer-demo` (`npm run dev --workspace composer-demo`), shows it; its shot at 390 x 844 is
`examples/composer-demo/shots/attachment-390x844.png`.

What a hold does, from Postern, with its fixes:

- A hold that ends without sending (a slide off, the phone taking the touch, the app hidden, the recogniser
  failing, a release it settles with no words) leaves the words heard so far in the box: 'Kept what you said:
  tap Send.' Nothing he said vanishes unsent (Postern mw-f7gmps.3).
- A long dictation is one turn: the recogniser ending by itself while he holds is started again, and every word is kept.
- A Bluetooth input (earbuds, a car) is listened on when there is one; one that gives no words within
  `INPUT_SILENT_MS` (2.5 s) is let go while he holds, the default microphone takes over, and that input is not
  chosen again (mw-f7gmps.1). On a phone's default microphone nothing else holds the microphone beside the
  recogniser (mw-f7gmps.2). A hold with no words says 'No speech was heard.'

The composer keeps no state of its own beyond the screen: no drafts, no storage, no network. The app sends.

## The look

Styling is class names and CSS custom properties only. `styles.css` (import it once) gives a plain default
look and reads every colour and size from a `--bk-composer-*` property with a default, so an app themes it by
setting the properties on `:root`, a parent or `.bk-composer`:

```css
:root {
  --bk-composer-accent: #0f766e;      /* the bar and Send */
  --bk-composer-accent-fg: #ffffff;
  --bk-composer-listening: #b45309;   /* the bar while held */
  --bk-composer-danger: #b91c1c;      /* the bar slid off, and errors */
  --bk-composer-surface: #fffdf7;
  --bk-composer-bar-height: 5rem;
  --bk-composer-bar-send-size: 3.5rem; /* the Send arrow beside the bar */
}
```

The full list is at the top of `styles.css`. Or leave the file out and style the classes: `bk-composer`
(`data-mode` 'speak' or 'type', `data-layout` 'bar' or 'field'), `__bar` (`data-state` 'idle', 'listening' or
'slid'), `__status`, `__live`, `__mic-name`, `__hint`, `__quiet-row`, `__quiet` (attach and camera),
`__type-instead`, `__bar-row`, `__bar-send` (the arrow beside the bar), `__field-row`, `__field`, `__mic`, `__send`, `__files`, `__file`, `__thumb`, `__remove`,
`__kept`, `__notice`, `__error`.

The class names and properties begin `bk-` for historical reasons: the composer was `@bsv-kit/composer` before it moved
here, and apps already theme these names, so they did not change.

## The parts

The hooks and services the Composer is made of are exported too, for an app that draws its own:
`HoldToTalkBar`, `useHold` (one hold: begin, finish, drop, the words so far), `browserSpeech`,
`transcribeRecording` and the `Transcriber` port, `startListening` (the recogniser with its restarts and
fallbacks), `openBluetoothInput` and `chooseInput` (which microphone), `VoiceRecorder`.

## Where it came from

Lifted from Postern: `src/cockpit/Composer.tsx`, `HoldToTalkBar.tsx`, `useHold.ts`, and `src/services/listen.ts`,
`micInput.ts`, `recorder.ts`, with their tests. Postern's behaviour is the specification. Left in Postern, as
its own: threads, drafts, saved prompts, quotes and shared-in files. It then lived in
[bsv-kit](https://github.com/Jonathan-A-White/bsv-kit) as `@bsv-kit/composer` until 0.3.0; see the [changelog](CHANGELOG.md).
