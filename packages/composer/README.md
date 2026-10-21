# @voice-kit/composer

Postern's message composer as a React component. Hold the big bar and talk (or, by a setting, tap it to keep the mic
on): the words show as they are heard, letting go sends them (or, by a setting, leaves them in the box for a Send), and sliding off the bar first keeps them in the box, unsent. Attach and camera sit quietly
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
      settings={{ attach: true, camera: true }}
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

## Settings

One object, `settings` (`Partial<ComposerSettings>`), says how the composer works. It drives `Composer`, `TalkBar` and `HoldToTalkBar`;
what it does not give is the default (`DEFAULT_COMPOSER_SETTINGS`).

| Setting     | Values (default first)            | What it does |
| ----------- | --------------------------------- | ------------ |
| `talk`      | `'hold'`, `'tap'`, `'off'`        | `'hold'`: hold the bar. `'tap'`: hold it as before, or tap it (a press shorter than `LATCH_MS`, 350 ms) to keep the mic on, and tap again to stop; the bar says 'Tap to stop'. `'off'`: no mic at all, the text box and Send only. |
| `send`      | `'release'`, `'button'`           | `'release'`: letting go sends. `'button'`: letting go (or stopping a latched listen) puts the words in the text box, nothing selected, and Send sends them, so a word can be fixed first. A slide off cancels in both. |
| `type`      | `true`, `false`                   | The 'Type a message' button under the bar. Off, the text box still shows for words a hold leaves in it. Always on when `talk` is `'off'`. |
| `attach`    | `false`, `true`                   | The attach button (paste and drop too). |
| `camera`    | `false`, `true`                   | The camera button. |
| `voiceNote` | `false`, `true`                   | Send each hold's voice as a voice note beside the words. |
| `lang`      | the page's `<html lang>`          | The language to listen for. |

Three shapes, one example each:

```tsx
// A message box: hold to talk, letting go sends, attach and camera below.
<Composer settings={{ attach: true, camera: true }} onSend={send} />

// A tutor box: tap to talk, the words wait in the box to be fixed, then Send.
<Composer settings={{ talk: 'tap', send: 'button' }} labels={{ hold: 'Hold to answer' }} onSend={send} />

// A bar alone: just the hold-to-talk bar, the words go to your own handler (see The parts).
<TalkBar settings={{ talk: 'tap' }} onWords={(text, words) => (words.status === 'heard' ? ask(text) : keepInField(text))}
  onHoldStart={pauseReading} onHoldEnd={() => resumeReading()} />
```

`TalkBar` is the bar and the hold behind it, for an app whose words do something of its own (a Talk sheet that pauses the read-aloud, a
drill, a reader's push-to-talk): `onWords(text, words)` gets the words of every hold, however it ended, so nothing he said is lost
(not called for a hold that heard nothing). `words.status` is `'heard'` when he let go and the recogniser settled them: words to send.
It is `'kept'` for any other end, the words heard so far, his, to keep unsent for him to send (the Composer puts them in its box with
'Kept what you said: tap Send.'): `words.ended` says how it ended, `'cancel'` (a slide off, the phone taking the touch), `'error'` (the
recogniser failed), `'ended'` (the recogniser ended by itself and could not be started again), `'hidden'` (he left the app), or
`'release'` (a release the recogniser settled blank). `onHoldStart` comes when listening starts and `onHoldEnd({ cancelled, ended })`
always follows, so what you paused is given back (`cancelled: false` only for a release).
Space or Enter held on the focused bar is a hold; `holdDelayMs={500}` makes a press wait before listening starts (let go sooner, it is no
hold); `labels` changes its words; `talk: 'off'` renders nothing. To draw the words so far or the notice beside the bar, run the hold
yourself and pass it in:

```tsx
const talk = useTalk({ talk: 'tap' }, { onWords: ask, transcriber });
<p>{talk.transcript || talk.notice}</p>
<TalkBar talk={talk} />
```

### Pausing what is read aloud while he talks

The `Composer` and `useTalk` hold through the same hold (`useBarHold`), so both take the same pair: `onHoldStart` as listening begins,
`onHoldEnd` once it is over, however it ended. Page audio can take the microphone from the recogniser; pause it for the hold:

```tsx
<Composer onSend={send} onHoldStart={() => audio.pause()} onHoldEnd={() => void audio.play()} />
<TalkBar onWords={ask} onHoldStart={() => audio.pause()} onHoldEnd={() => void audio.play()} />
```

The props that came before the object (`mode`, `attach`, `camera`, `recordVoice`, `lang`) still work, as the fallbacks: a value in
`settings` wins, else the old prop, else the default (`recordVoice` is the fallback for `voiceNote`). `mode` has no setting: it stays a
prop, the layout the composer opens in, and `resolveSettings(props)` is where it and the settings are read together.

## What the app passes

| Prop           | What it does                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------ |
| `onSend`       | Gets `{ text, files }` (each file `{ name, type, bytes, durationMs? }`). Return or resolve `false`, or throw, when it did not go: the words wait in the box. A thrown `Error`'s message is shown. |
| `settings`     | The settings above. |
| `mode`         | `'speak'` (default): the hold bar first. `'type'`: the text box and Send first, with a small mic that brings the bar out. |
| `transcriber`  | How audio becomes text. Default `browserSpeech` (the browser's SpeechRecognition, as Postern does: words as he speaks). `transcribeRecording(fn)` records the hold and calls `fn(recording)` on release for the words (your own speech-to-text service). |
| `attach`, `camera` | Fallbacks for `settings.attach` and `settings.camera`: show the attach (any file; paste and drop too) and camera buttons. Both hidden when not given. |
| `recordVoice`  | Fallback for `settings.voiceNote`: send each hold's voice as a voice note beside the words (with `browserSpeech`; `transcribeRecording` already has the recording). |
| `labels`       | Any of the words on the screen (`DEFAULT_LABELS`): `hold` 'Hold to talk', `tryAgain` 'Try again' (the bar after a hold that ended with a notice), `typeInstead` and `placeholder` 'Type a message', `release`, `releaseToBox` (send `'button'`), `stop` (a latched listen), `hint` and its variants `hintTap`, `hintBox`, `hintTapBox`, `drop`, `kept`, `send`, `speak`, `attach`, `camera`, ... |
| `refuseFile`   | `(file) => reason or undefined`: a refused file is not added and the reason is shown.            |
| `onNotice`     | Takes what the composer would say about a refused file or a failed send (to show it as a toast). |
| `onHoldStart`, `onHoldEnd` | A hold of the bar begins (before the microphone opens), and is over (`{ cancelled, ended }`, however it ended): pause what is read aloud and give it back. The same pair as `useTalk`'s; see _Pausing what is read aloud while he talks_. |
| `lang`, `appName` | `lang` is the fallback for `settings.lang` (default the page's `<html lang>`); `appName` is the app's name in "the microphone is not allowed for ..." |
| `open`         | `'bar'` or `'box'`: which shows first, and again after a send. Default: the bar in `mode` `'speak'`, the box in `'type'`. See below. |
| `text`, `onTextChange`, `onKeyDown`, `fieldOverlay`, `sendBlocked`, `renderSend`, `canSendEmpty`, `incomingFiles`, `onFileTap`, `maxLength`, `minRows` | The ways in for an app's own features; see _Plugging in an app's own features_ below. |
| `initialText`, `autoFocus`, `disabled`, `top`, `className` | Words already in the box; focus on open; nothing can be held or sent; a node at the top (a quote); a class on the root. |

Send with nothing said: attach a picture (or any file) and leave the box empty, and a Send arrow stands beside Hold to talk.
One tap sends the attachments with no words (`onSend` gets `{ text: '', files }`), so a picture needs no comment. Hold to talk
stays the big button, with the same height and place (it gives up only the arrow's width); with nothing attached nothing
changes, and once words are typed the text box's own Send is the one. The arrow waits while the bar is held. The example page,
`examples/composer-demo` (`npm run dev --workspace composer-demo`), shows it; its shot at 390 x 844 is
`examples/composer-demo/shots/attachment-390x844.png`.

## Plugging in an app's own features

Drafts, saved prompts, quotes, shared-in files and a file viewer stay the app's: the composer does not have them. These props are the ways
in (0.6.0, mw-06ggew.12). Each is additive: with none of them the composer behaves as it did.

**`text` and `onTextChange`: the app owns the words in the box.** A draft that loads after mount fills the box; a hold's words are kept
through `onTextChange` too. With only `onTextChange` the box stays the composer's own and the app hears every change.

```tsx
const [text, setText] = useState('');
useEffect(() => { loadDraft(channel).then((draft) => setText((now) => now || draft)); }, [channel]);
<Composer text={text} onTextChange={(next) => { setText(next); saveDraft(channel, next); }} onSend={send} />
```

**`onKeyDown`: before Enter.** Called first with the box's key event; `event.preventDefault()` keeps Enter from sending.

```tsx
<Composer text={text} onTextChange={setText}
  onKeyDown={(event) => { if (event.key === 'Tab' && suggestion) { event.preventDefault(); setText(`/${suggestion} `); } }} onSend={send} />
```

**`fieldOverlay`: a node laid over the box.** Drawn in `.bk-composer__field-wrap` (`position: relative`) after the text box, only while the
box shows. Position it with your own CSS.

```tsx
<Composer fieldOverlay={suggestion && <button type="button" className="grey-suggestion" onClick={take}>/{suggestion}</button>} ... />
```

**`sendBlocked`: not ready.** Send is greyed, Enter does not send, and a spoken release keeps its words in the box rather than sending them.

```tsx
<Composer sendBlocked={checkingPrompts || callFailed} ... />
```

**`renderSend`: your own Send button.** Drawn in place of the composer's, beside the box (`placement: 'field'`) and as the arrow beside the
bar (`'bar'`). It is given `{ send, canSend, blocked, busy, disabled, label, placement }`; its `send()` goes past `sendBlocked` (your button
decides that), but not an empty message, a message over `maxLength` or a send under way.

```tsx
<Composer sendBlocked={failed}
  renderSend={({ send, canSend, blocked, busy }) => (
    <HoldButton disabled={!canSend || busy} onHold={blocked ? send : undefined} onClick={blocked ? undefined : send}>
      {blocked ? 'Send (hold to send anyway)' : 'Send'}
    </HoldButton>
  )} ... />
```

**`canSendEmpty`: a message with nothing in it may go** (a quote alone). Send shows and is not greyed; `onSend` gets `{ text: '', files: [] }`.
In the bar layout the arrow beside the bar shows too.

```tsx
<Composer top={quote && <Quote {...quote} />} canSendEmpty={!!quote} onSend={({ text, files }) => send(withQuote(text, quote), files)} />
```

**`incomingFiles`: files that arrive after mount** (a share target). Each new array is added once to the waiting row, through `refuseFile`
like a picked file. Pass a new array for each batch.

```tsx
const [shared, setShared] = useState<File[]>([]);
useEffect(() => { takePendingShare().then((files) => files.length && setShared(files)); }, []);
<Composer incomingFiles={shared} open={shared.length ? 'bar' : 'box'} ... />
```

**`onFileTap`: a tap on a waiting file.** The thumbnail or name becomes a button (`labels.view(name)`, 'View photo.png' by default) that
calls `onFileTap({ name, type, preview, durationMs? })`; `preview` is the object URL of a picture or a voice note. Without it a waiting file is
not a button.

```tsx
<Composer onFileTap={(file) => (file.type.startsWith('image/') ? showViewer(file.preview) : download(file))} labels={{ view: (name) => `Open ${name}` }} ... />
```

**`open`: which comes first.** `'box'` opens on the text box with attach and camera on its left and the mic standing in for Send until there
is something to send; the mic brings the bar out. `'bar'` opens on the bar. The composer goes back to it after a send, and takes a change
made after mount (so a share with no words can open the bar). With `talk: 'off'` the box is all there is.

```tsx
<Composer open="box" settings={{ attach: true, camera: true }} ... />
```

**`maxLength` and `minRows`.** `maxLength={1000}` shows a live '12 of 1000' (`labels.count(length, max)`, `data-testid="composer-count"`,
class `bk-composer__count`, `data-over` when over) under the box and greys Send, and stops Enter, when the text is over it. The box does not
cut what is typed or pasted. `minRows={8}` is the box's rows when it is empty (one by default); it grows with the words up to its CSS max-height.

```tsx
<Composer maxLength={1000} minRows={8} labels={{ count: (n, max) => `${n} of ${max}` }} ... />
```

What a hold does, from Postern, with its fixes:

- A hold that ends without sending (a slide off, the phone taking the touch, the app hidden, the recogniser
  failing, a release it settles with no words) leaves the words heard so far in the box: 'Kept what you said:
  tap Send.' Nothing he said vanishes unsent (Postern mw-f7gmps.3).
- A long dictation is one turn, through any pause: when the recogniser ends by itself while he holds (Android Chrome on a
  pause or a blip), it is started again at once, the words heard before are kept and the words after follow them, each
  said once (`startListening`'s `throughPauses`, on by default; mw-06ggew.1). The cost is the phone's start tone at each
  restart. `throughPauses: false` spares the tone on a page that can record: the rest of the hold is recorded
  (`MediaRecorder`, on the input the hold is on) and on release its words follow the words heard before, by
  `transcribeRest` or, by default, the recording played silently, its silences cut, into a fresh recogniser (Chrome's
  `start(track)`); Android's own speech service hears nothing in such a replay, so use it only with a `transcribeRest` of
  your own (mw-q6n8m0.5). Words that cannot be made out come back as the result's `missed` (with `missedNote`), are said in
  the hold's notice and handed to `onNotice` when the app takes it, never dropped in silence.
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
(`data-mode` 'speak' or 'type', `data-layout` 'bar' or 'field'), `__bar` (`data-state` 'idle', 'listening', 'latched' or
'slid'), `__status`, `__live`, `__mic-name`, `__hint`, `__quiet-row`, `__quiet` (attach and camera),
`__type-instead`, `__bar-row`, `__bar-send` (the arrow beside the bar), `__field-row`, `__field-wrap`, `__field`, `__count`, `__mic`, `__send`, `__files`, `__file`, `__file-open` (the button on a file, with `onFileTap`), `__thumb`, `__remove`,
`__kept`, `__notice`, `__error`.

The class names and properties begin `bk-` for historical reasons: the composer was `@bsv-kit/composer` before it moved
here, and apps already theme these names, so they did not change.

## The parts

The hooks and services the Composer is made of are exported too, for an app that draws its own:
`TalkBar` and `useTalk` (the bar and its hold alone, words to your `onWords`), `HoldToTalkBar` (the bar when you run the hold: `settings.talk` hold, tap or off; drawn on `useBarPress`, the press logic `useTalk` uses too), `resolveSettings`, `useBarHold` (THE hold behind both bars: press, release, cancel, and every end handed to `onWords` between
`onHoldStart` and `onHoldEnd`; the Composer and `useTalk` both hold through it), `useHold` (the listening under it: begin, finish, drop, the words so far), `browserSpeech`,
`transcribeRecording` and the `Transcriber` port, `startListening` (the recogniser with its fallbacks and
the recorded rest of a hold), `openBluetoothInput` and `chooseInput` (which microphone), `VoiceRecorder`.

## Where it came from

Lifted from Postern: `src/cockpit/Composer.tsx`, `HoldToTalkBar.tsx`, `useHold.ts`, and `src/services/listen.ts`,
`micInput.ts`, `recorder.ts`, with their tests. Postern's behaviour is the specification. Left in Postern, as
its own: threads, drafts, saved prompts, quotes and shared-in files. It then lived in
[bsv-kit](https://github.com/Jonathan-A-White/bsv-kit) as `@bsv-kit/composer` until 0.3.0; see the [changelog](CHANGELOG.md).
