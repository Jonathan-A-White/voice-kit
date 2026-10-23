# Changelog: @voice-kit/composer

Newest first. Breaking changes come first in a release, each with its migration in one sentence.

## 0.8.0 (2026-10-23)

- New (mw-fu7dqf.3): `strictLang` on `ListenOptions`, `useHold`, `useTalk` (and so `TalkBar`) and the `Transcriber`'s start options: a hold
  that must hear one language (Greek) never walks on to en-US or to the browser's default language, where its speech would come out
  as English words. Its routes are the language's own, on-device then cloud (`listenRoutes(lang, onDevice, strict)`), and when the phone
  cannot hear the language the hold ends with a `'language-not-supported'` error whose message names the tag ('This phone cannot take
  dictation in el-GR (tried: ...)'). The on-device pack asked for is then the language's, not en-US. Nothing changes for a hold without the flag.
- New (mw-fu7dqf.3): `failure`, the `ListenError` the last hold failed with, on `useHold`, `useBarHold` and `useTalk` (its `kind` says
  why; cleared by the next hold), beside the existing `notice` string. README section 'Hearing one language only'.

## 0.7.0 (2026-10-21)

- Changed (breaking, mw-06ggew.14): `useTalk`'s `onWords` (and `TalkBar`'s) now gets the words of every hold, however it ended, as the
  Composer keeps them: a slide off or the phone taking the touch, the recogniser failing, the recogniser ending by itself, the page hidden
  each hand on the words heard so far as `{ status: 'kept', ended }` (before, they were dropped: Lampas's Talk sheet lost his words where
  Postern's Composer kept them). The second argument is now `HoldWords`, a `Released` of status 'heard' or 'kept' with `ended`. Migration:
  an `onWords` that sends whatever it gets should send only `words.status === 'heard'` and keep 'kept' words for him to send (a field).
- Changed (breaking, mw-06ggew.14): `HoldEnd` (`onHoldEnd`) has `ended`, how the hold ended: 'release', 'error', 'cancel', 'ended' or
  'hidden'. Migration: a test that matched `{ cancelled }` exactly matches `{ cancelled, ended }`.
- Fixed (mw-06ggew.14): a recogniser that ends by itself while he holds and cannot be started again ended the listening in silence, and the
  bar went on saying 'Release to send' while nothing was heard, so the release sent his words cut off where it gave up. The hold now ends
  there and then (`ListenOptions.onEnd`, `HoldOptions.onEnded`): the words heard so far are kept (the Composer's box, `onWords` 'kept'),
  with the notice that the words after could not be made out.
- New (mw-06ggew.14): `useBarHold`, THE hold of a hold-to-talk bar: press, release and cancel, and every end (release, error, cancel,
  ended, hidden) handed to `onWords` between `onHoldStart` and `onHoldEnd`. The Composer and `useTalk` both hold through it, so no app
  gets a hold that behaves differently from Postern's. Exported with types `BarHoldOptions`, `HoldEnding`, `HoldWords`.
- New (mw-06ggew.14): `Composer` takes `onHoldStart` and `onHoldEnd`, as `useTalk` does: pause what is read aloud while he talks. README
  section 'Pausing what is read aloud while he talks'.

## Unreleased (0.6.0)

- New (mw-06ggew.12): extension points on `Composer` for an app's own features (drafts, saved prompts, quotes, shared-in files, a file viewer,
  a character limit), all additive: with none of them the composer behaves as in 0.5.1. README section 'Plugging in an app's own features'.
  - `text` + `onTextChange`: the app owns the box's words (a draft that loads after mount fills the box); `onTextChange` alone just hears them.
  - `onKeyDown`: called before the composer's Enter handling; `preventDefault()` keeps Enter from sending.
  - `fieldOverlay`: a node drawn in the new `.bk-composer__field-wrap` after the text box (the text box now sits in this wrapper).
  - `sendBlocked`: Send greyed, Enter and a spoken release do not send (the words wait in the box). `renderSend(slot)`: your own Send button, beside
    the box and as the arrow beside the bar; `slot.send()` goes past `sendBlocked`. `canSendEmpty`: a message with no words and no files may go.
  - `incomingFiles`: files that arrive after mount are added to the waiting row (each new array once, through `refuseFile`).
  - `onFileTap`: a waiting file becomes a button (`labels.view`) that gives the app the file and its preview URL.
  - `open` ('bar' or 'box'): which shows first in either layout, and after a send; `resolveSettings` reads it with `mode`. `ComposerOpen` is exported.
  - `maxLength`: a live 'N of M' count (`labels.count`) under the box; Send greyed over it. `minRows`: the box's rows when empty.
  - New exports: types `SendSlot`, `WaitingFile`, `ComposerOpen`. New labels: `view`, `count`.
  - Migration: none. (A stylesheet that targeted the text box as a direct child of `.bk-composer__field-row` should target `.bk-composer__field-wrap`.)

## Unreleased (0.5.1)

- New (mw-06ggew.3): `TalkBar` and `useTalk`, the hold-to-talk bar and its hook alone, for an app with its own handler for the words (a Talk
  sheet that pauses the read-aloud, a drill, a reader's push-to-talk) rather than a message box.
  - `useTalk(settings, { onWords, onHoldStart?, onHoldEnd?, transcriber?, lang?, appName?, holdDelayMs?, dropOnSlideOff? })` runs the hold
    (`useHold`) behind the bar and returns its state (`listening`, `state`, `transcript`, `notice`, `mic`, `supported`, ...) and `bar`, the
    handlers to spread on a button. `TalkBar` is the bar drawn on it: the Composer's look (`bk-composer__bar`, `data-state`), labels
    configurable (`labels`, `DEFAULT_TALK_LABELS`); `<TalkBar talk={useTalk(...)} />` draws a hook you run yourself.
  - `settings.talk` 'hold', 'tap' (a quick tap latches, the next tap stops; `LATCH_MS`) or 'off' (renders nothing, no hold starts), as in `Composer`.
  - Space or Enter held on the focused bar is a hold. `holdDelayMs` makes a press wait that long before listening starts (talk 'hold'): let go
    or slid off sooner, it is no hold and nothing is called. `onHoldStart` comes with the start, before the microphone opens; `onHoldEnd`
    always follows it: `{ cancelled: false }` after the last words are in (just before `onWords`), `{ cancelled: true }` for a slide off, the
    phone taking the touch, a recogniser that failed, a hidden page, or a hold that could not start.
  - `HoldToTalkBar` is now drawn on the same press logic, `useBarPress`, which is exported: one copy of the press logic in the kit.
  - Migration: none.

## Unreleased (0.5.0)

- New (mw-06ggew.2): ONE settings object, `ComposerSettings`, drives `Composer` and `HoldToTalkBar` (`settings?: Partial<ComposerSettings>`):
  `talk` ('hold', 'tap' or 'off'), `send` ('release' or 'button'), `type`, `attach`, `camera`, `voiceNote`, `lang`. `DEFAULT_COMPOSER_SETTINGS`
  (hold, release, type on, attach, camera and voiceNote off) and `resolveSettings(props)` are exported; `resolveSettings` is the one place the
  components read these choices.
  - `talk: 'tap'` works as whisper-hid's talkPress does: a press shorter than `LATCH_MS` (350 ms) latches the mic on (the bar says 'Tap to stop',
    `data-state='latched'`) and the next tap stops it; a longer press is a hold as before. `talk: 'off'` shows no mic (the bar renders nothing).
  - `send: 'button'`: letting go (or stopping a latched listen) puts the words in the text box, the caret after them and nothing selected, and Send
    sends them, so a word can be fixed first. A slide off still cancels, keeping the words unsent.
  - `type: false` takes away the 'Type a message' button.
  - New labels for the new states (`stop`, `releaseToBox`, `hintTap`, `hintBox`, `hintTapBox`); `HoldToTalkBar` takes `latchedLabel`.
  - Migration: none. The props `mode`, `attach`, `camera`, `recordVoice` and `lang` still work as the fallbacks for the settings that say the same
    (a value in `settings` wins); an app can move when it likes.

## Unreleased (0.4.0)

- Fixed: a pause in a hold no longer cuts him off on Android (mw-06ggew.1, Postern's `listensThroughPauses` lifted in). `startListening`
  takes a new option `throughPauses`, true by default: when the recogniser ends by itself while he holds, it is started again at once
  (up to `MAX_IDLE_RESTARTS` quick ends in a row, as a page that cannot record always did), the words before and after the pause are
  joined into one text and a phrase the restarted recogniser hears again is said once. Android's speech service hears nothing in the
  recorded-rest replay of mw-q6n8m0.5 and the words after a pause were lost; an app no longer needs to hide `MediaRecorder` to get
  this. The cost is the phone's start tone at each restart. Migration: none for an app that wants it; `throughPauses: false` keeps the
  record-and-replay path (and its `transcribeRest`) for a page that can record.
- Changed (breaking, only for code that read the 0.3.0-unreleased `missed`): the result's `missed` is `true` and the words for the
  screen are its `missedNote`. A stretch that could not be made out (the speech service failed on it, the recogniser could not be started
  again, the recording could not be read) is said: `useHold`'s notice shows it, `Released`'s 'heard' carries it as `missed`, and `Composer`
  hands it to `onNotice` when the app takes notices.
- Earlier in this release (mw-q6n8m0.5, carried from bsv-kit by mw-q6n8m0.18): with `throughPauses: false` a pause rings no bell. The
  recogniser is started once in a hold; when it ends by itself while he holds, the rest of the hold is recorded and on release its words
  follow those heard before (`startListening`'s `transcribeRest`, by default the recording played into a fresh recogniser). A page that
  cannot record starts the recogniser again.

## Moved to voice-kit (2026-10-16)

- Changed (breaking): moved from bsv-kit at b8b2ba303b9397ddb83935f9bde74107903bb074, where this was @bsv-kit/composer 0.3.0. The package is now
  `@voice-kit/composer` and its entry points are `voice-kit/composer` and `voice-kit/composer/styles.css`; the code is unchanged. Migration: install
  `github:Jonathan-A-White/voice-kit#<full commit SHA>` and change `bsv-kit/composer` to `voice-kit/composer` in each import.
  The `bk-composer__*` class names and `--bk-composer-*` properties keep their names.
- The entries below were written in [bsv-kit](https://github.com/Jonathan-A-White/bsv-kit), whose history before that
  commit is this package's past.

## 0.3.0 (2026-10-15)

- Changed: the language-not-supported message now ends with the routes tried, as in '(tried: on-device en-US, cloud en-US,
  cloud default)'; an app whose tests match the whole message takes the suffix.
- Fixed: a language-not-supported no longer reaches the screen when another route can hear him (mw-hgtlf5.1). On Android
  Chrome `processLocally` is offered but never honoured: every on-device start is answered language-not-supported a moment
  later, opens no microphone and fires no end event, so a hold let go before that answer used to settle with the error and
  show it. Now such a hold settles with nothing heard. A language-not-supported walks the hold's routes, each once
  (`listenRoutes`): on-device and cloud in the page's language, then on-device en-US (asking Chrome's
  `SpeechRecognition.install` for the pack where it exists, once, for later holds) and cloud en-US, then the cloud with
  no language set; only the last route's failure is shown.
- New: after a hold that ended with a notice and no words, the bar says `tryAgain` 'Try again': a hold on it is a fresh
  one, every route untried. `useHold`'s `mode` follows the route the mic opened on.
- New: `listenRoutes`, `routeName` and the `ListenRoute` type are exported.

## 0.2.0 (2026-10-10)

- New: with something attached and nothing typed, a Send arrow stands beside Hold to talk (mw-jtzpw0.9): one tap sends the
  attachments with no words (`onSend` gets `text: ''`). Hold to talk stays the big button, in the same place and the same
  height, and gives up only the arrow's width; with nothing attached the composer looks as before, and with words typed the
  text box's own Send stays. The arrow is the `bk-composer__bar-send` button, sized by `--bk-composer-bar-send-size`, named by
  the existing `send` label, and held back while the bar is held. The bar now sits in a `bk-composer__bar-row` with it.

## 0.1.0 (2026-10-09)

- New: the `Composer` React component, lifted from Postern's composer (mw-jtzpw0.1): hold to talk with the words
  shown as they are heard, let go to send, slide off to keep them unsent; attach and camera quiet below the bar
  and hidden unless the app asks; 'Type a message'; `mode` 'speak' (the bar first) or 'type' (the text box and
  Send first, with a small mic); every word on the screen replaceable through `labels`; themed through
  `--bk-composer-*` CSS custom properties and `bk-composer__*` classes (`bsv-kit/composer/styles.css`).
- New: how audio becomes text is the app's `Transcriber`: `browserSpeech` (the browser's recogniser, as Postern)
  or `transcribeRecording(fn)` (the hold's recording, turned into words by the app's function on release).
- New: the parts, exported: `HoldToTalkBar`, `useHold`, `startListening`, `openBluetoothInput`, `VoiceRecorder`,
  with Postern's fixes mw-f7gmps.1 (a silent Bluetooth input gives way to the default microphone while he holds),
  mw-f7gmps.2 (no recorder holds the phone's microphone beside the recogniser) and mw-f7gmps.3 (a hold that ends
  without sending leaves its words in the box, unsent).
- Changed from Postern: the microphone-permission messages name the app from `appName` ('this app' when not
  given) where Postern's said 'Postern'.
