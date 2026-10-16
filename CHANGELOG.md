# Changelog: voice-kit

Newest first. Breaking changes come first in a release, each with its migration in one sentence.

Each library keeps its own changelog; this one records the repo's releases and points at them:

- [@voice-kit/composer](packages/composer/CHANGELOG.md)
- [@voice-kit/speech](packages/speech/CHANGELOG.md)
- [@voice-kit/testing](packages/testing/CHANGELOG.md)

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
