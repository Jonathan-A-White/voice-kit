# Wake-word probe

`probe.mjs` is the headless proof for route (d) of [docs/wake-word-engines.md](../../docs/wake-word-engines.md):

- a small classifier, trained from scratch on the laptop, to hear 'Hey Lampas';
- over a plain log-mel front end written in the script;
- from files that are ours or permissive at their source.

It is a spike, not a library. Nothing in it is exported, and no package imports it.

<!-- toc -->

- [What it needs](#what-it-needs)
- [Where it keeps things](#where-it-keeps-things)
- [How to run it](#how-to-run-it)
- [Tests](#tests)

<!-- /toc -->

## What it needs

- Node 20 or later. The script has no npm dependency, and nothing is added to the repo's `package.json`.
- `espeak-ng` and `ffmpeg` on the PATH. To use other copies, set `ESPEAK_NG` and `FFMPEG` to their paths.
- LibriSpeech dev-clean (CC BY 4.0, 337,926,286 bytes), unpacked into the scratch folder:

  ```sh
  mkdir -p ~/.cache/voice-kit-wake-spike/probe/dl/librispeech
  cd ~/.cache/voice-kit-wake-spike/probe/dl/librispeech
  curl -LO https://www.openslr.org/resources/12/dev-clean.tar.gz
  tar xzf dev-clean.tar.gz      # makes LibriSpeech/dev-clean
  ```

## Where it keeps things

The probe keeps everything it makes in a scratch folder outside the repo:

- the sayings;
- the decoded speech;
- `model.json`, the weights.

The scratch folder is `~/.cache/voice-kit-wake-spike/probe` by default. To use another, pass `--scratch DIR` or set
`WAKE_PROBE_SCRATCH`.

The LibriSpeech folder defaults to `<scratch>/dl/librispeech/LibriSpeech/dev-clean`. To use another, pass
`--librispeech DIR` or set `WAKE_PROBE_LIBRISPEECH`.

You may delete the scratch folder at any time. Nothing in it is committed.

## How to run it

From the repo root, run it as one process, at low priority:

```sh
nice -n 10 node scripts/wake-probe/probe.mjs all
```

`all` runs three steps in turn. Each can also be run on its own: `prepare`, `train` or `test`.

1. `prepare` makes the training audio:
   - 1,152 espeak-ng sayings of 'Hey Lampas';
   - 840 sayings of near words and sentences;
   - 107 minutes of LibriSpeech speech from 30 speakers, and 22 minutes from 10 other speakers, held out.

   The sayings are kept once made. To make them again, delete `<scratch>/data`.
2. `train` trains the classifier and writes `<scratch>/model.json`.
3. `test` tests the model:
   - it says 'Hey Lampas' in four espeak-ng voices the model never trained on, and each must be heard;
   - it plays `packages/testing/clips/english.wav` ('Please read me the first chapter'), which must not be heard;
   - for information only, it counts false wakes over the held-out LibriSpeech speech.

   To also try clips of your own that must not wake it, add `--clips a.wav,b.wav`.

The exit code:

- 0 when every check passes;
- 1 when one fails;
- 2 on an error, for example a missing tool or folder.

## Tests

```sh
node --test scripts/wake-probe/probe.test.mjs
```

These check the front end and the classifier's pieces, and the document's table, verdicts and Recommendation. They
need no network and no model. The root `npm test` does not run them: its vitest include stops at `scripts/*.test.mjs`.
