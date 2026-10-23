# Changelog: voice-kit

Newest first. Breaking changes come first in a release, each with its migration in one sentence.

Each library keeps its own changelog; this one records the repo's releases and points at them:

- [@voice-kit/composer](packages/composer/CHANGELOG.md)
- [@voice-kit/speech](packages/speech/CHANGELOG.md)
- [@voice-kit/talks](packages/talks/CHANGELOG.md)
- [@voice-kit/testing](packages/testing/CHANGELOG.md)

## v0.13.0 (2026-10-23)

- @voice-kit/composer 0.8.0 (mw-fu7dqf.3): `strictLang`, a hold that hears one language or nothing (never en-US, never the browser's
  default), ending with a `'language-not-supported'` error that names the language; `failure` on the hold's state. Additive. See
  [its changelog](packages/composer/CHANGELOG.md).

## v0.12.0 (2026-10-23)

- @voice-kit/talks 0.5.0 (mw-t3xu9a.3): the grind side of the tutor client, `voice-kit/talks/grind`: the instructions part that teaches
  the protocol (under 6,000 bytes), the answer schema fragment for `asks`, `do`, `go`, `misses` and `said`, and an example answer of
  each kind; the plain files ship too. Additive. See [its changelog](packages/talks/CHANGELOG.md).

## v0.11.0 (2026-10-23)

- @voice-kit/talks 0.4.0 (mw-t3xu9a.2): the tutor client learns what to carry up front, by counting. A screen's up-front list is the
  core facts plus those asked back at least 2 times in its last 50 turns (settable), `applyWeights` records an applied list with its
  date and source, `rate` / `change` give ask-backs per 100 turns before and after, and `weightsReport(since)` is what a nightly
  run reads (with `changed`). The tutor record gains `turn` and `weights` lines. See [its changelog](packages/talks/CHANGELOG.md).
- @voice-kit/testing 0.3.1 (mw-t3xu9a.2): the fake talk store keeps the new record lines. Additive.

## v0.10.0 (2026-10-23)

- @voice-kit/talks 0.3.0 (mw-t3xu9a.1): the tutor client. `defineRegistry({ facts, commands, places })` and
  `createTutorClient(...)`: each request carries the up-front facts and the catalogue under a byte budget; an answer's `asks` get a
  follow-up round (two at most), its `do` runs commands (free, undoable, confirm), its `go` opens a place, and every ask-back and
  miss is recorded per screen. The in-memory and Dexie stores keep the record and the up-front lists (`TutorStore`; the Dexie
  database goes to version 2). The core still imports nothing. See [its changelog](packages/talks/CHANGELOG.md).
- @voice-kit/testing 0.3.0 (mw-t3xu9a.1): the fake talk store is also a `TutorStore`. Additive.

## v0.9.0 (2026-10-22)

- @voice-kit/talks 0.2.0 (mw-79en7t.31): talks kept on the device and shown on screen. `voice-kit/talks/dexie` (`createDexieStore`, a
  `TalkStore` in IndexedDB through Dexie, held to the same contract as the in-memory store), `voice-kit/talks/react` (`TalkList`, a
  searchable list that opens a talk) and `voice-kit/talks/styles.css`. The core `voice-kit/talks` still imports nothing. `dexie` is
  a new optional peer. See [its changelog](packages/talks/CHANGELOG.md).
- @voice-kit/testing 0.2.0 (mw-79en7t.31): `voice-kit/testing/talks` (also exported from the package index): `createFakeGrind`, a grind
  that answers scripted turns, and `createFakeTalkStore`, an in-memory store that records every call. Additive. See
  [its changelog](packages/testing/CHANGELOG.md).
- The consumer smoke covers the new entry points (the exports map now has twelve).

## v0.8.0 (2026-10-21)

- @voice-kit/speech 0.2.0 (mw-vmx5cb.4): `speak()` takes `voice`, `rate`, `pitch` and `rank`, and `preferredVoice()` takes a `rank`
  function applied after the language match. Additive: left out, behaviour is today's. See [its changelog](packages/speech/CHANGELOG.md).

## v0.7.0 (2026-10-21)

- @voice-kit/composer 0.7.0 (mw-06ggew.14): one hold for the Composer and `useTalk` (`useBarHold`); every way a hold ends hands on
  the words heard so far, through both; `onHoldStart` and `onHoldEnd` on the Composer too. Breaking for an `onWords` that sends
  whatever it gets: see [its changelog](packages/composer/CHANGELOG.md).

## 0.1.0 (2026-10-16, not yet tagged)

- New: the repo. `@voice-kit/composer`, `@voice-kit/speech` and `@voice-kit/testing` moved from bsv-kit at
  b8b2ba303b9397ddb83935f9bde74107903bb074, where they were @bsv-kit/composer 0.3.0, @bsv-kit/speech 0.1.0 and
  @bsv-kit/testing 0.1.0, with the composer demo and bsv-kit's tooling (lint, typecheck, the personal and credits
  checks, the consumer smoke test, the Chromium tests, CI). The code is unchanged.
- Changed (breaking, for an app moving from bsv-kit): the entry points are `voice-kit/composer`,
  `voice-kit/composer/styles.css`, `voice-kit/speech`, `voice-kit/speech/react`, `voice-kit/speech/styles.css`,
  `voice-kit/testing/speech` and `voice-kit/testing/mic`. Migration: install voice-kit by commit and change `bsv-kit/` to
  `voice-kit/` in each of those imports; the `bk-` class names, the `--bk-*` properties and `window.__bsvKitTesting` are
  unchanged.
- Package versions: composer 0.3.0, speech 0.1.0, testing 0.1.0.
