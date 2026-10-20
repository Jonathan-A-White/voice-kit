# Changelog: @voice-kit/composer

Newest first. Breaking changes come first in a release, each with its migration in one sentence.

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
