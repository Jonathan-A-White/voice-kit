# voice-kit

Speaking and listening in the browser, for React web apps on a phone. Three small TypeScript libraries, lifted from the
working code in [Postern](https://github.com/Jonathan-A-White/postern) by way of
[bsv-kit](https://github.com/Jonathan-A-White/bsv-kit), where they lived until 2026-10-16:

- `@voice-kit/composer`: a message composer, a React component: hold to talk with the words shown as they are heard,
  slide off to keep them unsent, quiet attach and camera, 'Type a message'; speak-first or type-first; themed by CSS
  custom properties. See [packages/composer](packages/composer/README.md).
- `@voice-kit/speech`: a read-aloud engine: a text spoken a sentence at a time, Pause, Resume, Restart and Stop that
  keep the place, a hidden page or a left screen pauses it, and every utterance names its language (Greek, Hebrew or
  English, from its letters) and a voice for it. A React entry gives `useSpeaking(key)` and a themeable `SpeakingBar`.
  See [packages/speech](packages/speech/README.md).
- `@voice-kit/talks`: multi-turn conversations: a talk of turns with roles and times, the turn loop over a grind the app
  injects, picture turns, and a store interface with an in-memory store. No React, no DOM; the Composer's `useTalk`
  drives it as it is. See [packages/talks](packages/talks/README.md).
- `@voice-kit/testing`: honest fakes for an app's tests, in vitest and in Playwright: a speech synthesiser and a
  microphone (getUserMedia, MediaRecorder, SpeechRecognition) that behave like Android Chrome in time. See
  [packages/testing](packages/testing/README.md).

What belongs here: the browser's speech and microphone APIs, the UI over them, and honest fakes of exactly those APIs.
Nothing here needs a key, a server or storage. Each library imports nothing from the others; a test in each says so.

The composer needs React 18 or later (`react`, `react-dom`); speech needs React only for its `voice-kit/speech/react`
entry; testing needs none. React is an optional peer dependency, so an app that uses only the speech engine or the
fakes installs no React for them. [examples/composer-demo](examples/composer-demo/README.md) shows the composer on a
phone-sized page (`npm run demo` serves it).

## Install

From GitHub, by full commit SHA (there is no registry and no tag yet); `prepare` builds the libraries on install. An app
pins a commit, never a branch:

```bash
npm install github:Jonathan-A-White/voice-kit#d91eecfea2f724ca7bc569f365753941828ce589
```

That commit is the first with all three libraries, voice-kit 0.1.0 (composer 0.3.0, speech 0.1.0, testing 0.1.0). A later
commit is pinned the same way, by its full SHA.

npm 11 warns that `voice-kit` has an install script (`prepare`, the build) not yet covered by `allowScripts`. Allow it
with `npm install-scripts approve voice-kit`, which adds an entry to your `package.json` keyed by the install line, for
example:

```json
"allowScripts": { "github:Jonathan-A-White/voice-kit#d91eecfea2f724ca7bc569f365753941828ce589": true }
```

Check that `package-lock.json` resolves it as `git+https://github.com/Jonathan-A-White/voice-kit.git#<the SHA>`, not
`git+ssh`, so a machine with no GitHub key installs it too.

### Moving from bsv-kit

The entry points keep their last segment, so the move is one word per import: `bsv-kit/composer` becomes
`voice-kit/composer`, and the same for `composer/styles.css`, `speech`, `speech/react`, `speech/styles.css`,
`testing/speech` and `testing/mic`. Change any vitest alias or `vi.mock` path that names them too. Nothing else
changes: the `bk-` class names and `--bk-*` properties, and the fakes' page handle `window.__bsvKitTesting`, keep their
names (historical, from bsv-kit; apps already theme and read them). bsv-kit's own `bsv-kit/testing`, the fake Postern for
grist tests, did not move.

## Examples

`voice-kit/composer` and its stylesheet: the composer at the foot of a page, the app sending what it gets.

```tsx
import { Composer, type ComposerMessage } from 'voice-kit/composer';
import 'voice-kit/composer/styles.css'; // its default look, themed by --bk-composer-* properties

export function Ask({ send }: { send: (m: ComposerMessage) => Promise<boolean> }) {
  return <Composer mode="speak" attach camera labels={{ hold: 'Hold to ask' }} onSend={send} />;
}
```

`voice-kit/speech`: read aloud, framework-free.

```ts
import { speak, pause, resume, stop, getSpeech } from 'voice-kit/speech';

speak('First sentence. Second sentence.', { key: 'article' });
pause(); // keeps the sentence reached
resume(); // speaks on from it
console.log(getSpeech().status); // 'playing'
stop();
```

`voice-kit/speech/react` and its stylesheet: the button a screen reads, and the one bar for anything read aloud.

```tsx
import { speak, stop } from 'voice-kit/speech';
import { SpeakingBar, useSpeaking } from 'voice-kit/speech/react';
import 'voice-kit/speech/styles.css'; // the bar's default look, themed by --bk-speech-* properties

export function ReadAloud({ text }: { text: string }) {
  const speaking = useSpeaking('article');
  return (
    <>
      <button onClick={() => (speaking ? stop() : speak(text, { key: 'article' }))}>{speaking ? 'Stop' : 'Read aloud'}</button>
      <SpeakingBar />
    </>
  );
}
```

`voice-kit/testing/speech` and `voice-kit/testing/mic`, in an app's vitest (TEST-ONLY): an honest synthesiser and
microphone on the window, on fake timers.

```ts
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { installSpeech } from 'voice-kit/testing/speech';
import { installMic, clips } from 'voice-kit/testing/mic';

let speech: ReturnType<typeof installSpeech>;
let mic: ReturnType<typeof installMic>;
beforeEach(() => {
  vi.useFakeTimers();
  speech = installSpeech(window);
  mic = installMic(window, { clip: clips.english }); // "Please read me the first chapter"
});
afterEach(() => {
  speech.uninstall();
  mic.uninstall();
  vi.useRealTimers();
});

it('reads the answer aloud to its end', async () => {
  // ... render the app, hold to talk, let go ...
  await vi.advanceTimersByTimeAsync(10_000);
  expect(speech.spoken()).toHaveLength(1);
});
```

In Playwright the same fakes go in as init scripts: `page.addInitScript(speechInitScript())` and
`page.addInitScript(micInitScript({ clip: clips.greek }))`. See [packages/testing](packages/testing/README.md).

## Modules

| Entry point | Exports | What it is | Postern source |
| --- | --- | --- | --- |
| `voice-kit/composer` | `Composer`, `HoldToTalkBar`, `useHold`, `browserSpeech`, ... | the hold-to-talk message composer (React) | `src/services/`: `listen.ts`, `micInput.ts`, `recorder.ts`; `src/cockpit/`: `Composer.tsx`, `HoldToTalkBar.tsx`, `useHold.ts` |
| `voice-kit/composer/styles.css` | | the composer's default look | |
| `voice-kit/speech` | `speak`, `pause`, `resume`, `restart`, `stop`, ... | read aloud a sentence at a time, keeping the place; language and voice per utterance | `src/services/speech.ts` |
| `voice-kit/speech/react` | `SpeakingBar`, `useSpeaking`, `useSpeech` | the one bar for anything read aloud, and the hook a speaker button reads (React) | `src/cockpit/`: `SpeakingBar.tsx`, `useSpeaking.ts` |
| `voice-kit/speech/styles.css` | | the bar's default look | |
| `voice-kit/testing/speech` | `installSpeech`, `speechInitScript` | TEST-ONLY honest speechSynthesis, vitest and Playwright | (new; not from Postern) |
| `voice-kit/testing/mic` | `installMic`, `micInitScript`, `clips` | TEST-ONLY honest getUserMedia, MediaRecorder and SpeechRecognition | (new; not from Postern) |

## Credits

> "If I have seen further it is by standing on the shoulders of Giants."
> Isaac Newton, letter to Robert Hooke, 1675

voice-kit stands on the work below. Each credit gives what it is used for, its licence and any changes made. None of it is
changed by us: we use each as published.

A source added or removed changes its credit in the same commit, and the credits test says so: each credit ends with its
`Kind:` (package, tool, service, idea, font or data); a package credit fails when that package is no longer in a package.json,
and every bundled font or data file must be named in backticks by a font or data credit.

Runtime libraries the app brings (peer dependencies of the composer and speech's React entry only):

- [React](https://react.dev): `react` and `react-dom`, the UI library `@voice-kit/composer` and `@voice-kit/speech/react` are written for (18 or later). Licence:
  [MIT](https://github.com/facebook/react/blob/main/LICENSE). No changes. Kind: package.

Tools used to build and test (not installed by apps):

- [TypeScript](https://github.com/microsoft/TypeScript): the language and compiler. Licence:
  [Apache-2.0](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt). No changes. Kind: package.
- [Vitest](https://vitest.dev): runs the tests. Licence: [MIT](https://github.com/vitest-dev/vitest/blob/main/LICENSE). No changes. Kind: package.
- [ESLint](https://eslint.org): the linter. Licence: [MIT](https://github.com/eslint/eslint/blob/main/LICENSE). No changes. Kind: package.
- [Vite](https://vite.dev): serves and builds the example page under `examples/`. Licence:
  [MIT](https://github.com/vitejs/vite/blob/main/LICENSE). No changes. Kind: package.
- [@testing-library/react](https://testing-library.com/docs/react-testing-library/intro): renders the composer and the
  SpeakingBar in their tests. Licence: [MIT](https://github.com/testing-library/react-testing-library/blob/main/LICENSE). No changes. Kind: package.
- [@testing-library/dom](https://testing-library.com/docs/dom-testing-library/intro): finds what those tests
  render. Licence: [MIT](https://github.com/testing-library/dom-testing-library/blob/main/LICENSE). No changes. Kind: package.
- [playwright-core](https://playwright.dev): drives the Chromium that the smoke test of `@voice-kit/testing` installs its fakes
  into, and that the composer demo's shot test measures. Licence: [Apache-2.0](https://github.com/microsoft/playwright/blob/main/LICENSE). No changes. Kind: package.
- [jsdom](https://github.com/jsdom/jsdom): the page the composer's and speech's tests run in. Licence:
  [MIT](https://github.com/jsdom/jsdom/blob/main/LICENSE.txt). No changes. Kind: package.

Data bundled with `@voice-kit/testing`:

- [eSpeak NG](https://github.com/espeak-ng/espeak-ng): its synthesiser spoke the two test clips in `packages/testing/clips` (an English and
  a Greek sentence), made again by `packages/testing/scripts/make-clips.mjs`; the clips are committed as audio, the program is not
  shipped. Licence: [GPL-3.0-or-later](https://github.com/espeak-ng/espeak-ng/blob/master/COPYING). We use its output as it came, resampled to 16 kHz.
  Kind: data.

Projects and ideas we took:

- [Postern](https://github.com/Jonathan-A-White/postern): the composer and the speech engine and bar are lifted from Postern's working
  code, whose behaviour is their specification. Licence: [MIT](https://github.com/Jonathan-A-White/postern/blob/main/LICENSE). They keep
  Postern's UI and its tests and leave Postern's own parts (threads, drafts, saved prompts) in Postern. Kind: idea.
- [bsv-kit](https://github.com/Jonathan-A-White/bsv-kit): these three libraries, their tests and this repo's tooling lived there first and were
  moved here at one commit, named in each package's changelog. Licence: [MIT](https://github.com/Jonathan-A-White/bsv-kit/blob/main/LICENSE).
  Kind: idea.
- [FFmpeg](https://ffmpeg.org): resampled and trimmed the test clips of `@voice-kit/testing` once, to make them. Licence:
  [LGPL-2.1-or-later](https://ffmpeg.org/legal.html). Used as published. Kind: tool.
- [Beads](https://github.com/steveyegge/beads): Steve Yegge's issue tracker for AI agents; the work on this repo is tracked in it.
  Licence: [MIT](https://github.com/steveyegge/beads/blob/main/LICENSE). Used as published. Kind: tool.
- [Gas Town](https://github.com/steveyegge/gastown): Steve Yegge's idea of a factory of coordinating agent roles, which shaped how
  this repo is built. Licence: [MIT](https://github.com/steveyegge/gastown/blob/main/LICENSE). We took the idea, not its code. Kind: idea.
- [Claude Code](https://www.anthropic.com/claude-code): Anthropic's coding agent, which writes the code in this repo under the
  Governor's direction. Licence: [commercial terms](https://www.anthropic.com/legal/commercial-terms). Used as a tool. Kind: tool.

## Develop

```bash
npm ci --no-audit --no-fund && npm run lint && npm run typecheck && npm test && npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to build, test and propose a change, and [CHANGELOG.md](CHANGELOG.md) for
what each release changed. MIT licensed: see [LICENSE](LICENSE).
