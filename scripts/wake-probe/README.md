# Wake-word probe

Route (d) of [docs/wake-word-engines.md](../../docs/wake-word-engines.md): our own small network that hears
'Hey Lampas', trained from scratch on the laptop from files that are ours or permissive at their source.

- `detector.mjs` is the scoring code: the log-mel front end, the network and the rule that turns scores into one wake.
  It is plain JavaScript with no import, so the page can run it as it is (story mw-rdpwdp1.3).
- `probe.mjs` makes the audio, sets the threshold and measures. Everything it scores goes through `detector.mjs`.
- `train.py` trains the network (PyTorch, on the CPU) on features `probe.mjs` made with `detector.mjs`.
- `handsfree.mjs` is a car's Bluetooth hands-free microphone, simulated: road noise and the Bible leaking back, a noise
  suppressor, automatic gain, and a narrowband (CVSD) or wideband (mSBC) call-quality link. `probe.mjs` trains and
  measures through it (story mw-rdpwdp1.12; see [The car's microphone](#the-cars-microphone)).
- `vits_say.py` speaks sayings with Coqui's VITS voice trained on VCTK (109 speakers).

The trained model is committed as `examples/wake-spike/public/models/hey-lampas.json`. Beside it,
`examples/wake-spike/public/models/licences.json` lists every file, dataset and tool the training used. The model holds
the weights, the front end's numbers, the threshold, the date, and the commit that trained it.

It is a spike, not a library. Nothing in it is exported, and no package imports it.

<!-- toc -->

- [What it needs](#what-it-needs)
- [Where it keeps things](#where-it-keeps-things)
- [How to run it](#how-to-run-it)
- [The three sets](#the-three-sets)
- [The car's microphone](#the-cars-microphone)
- [Tests](#tests)

<!-- /toc -->

## What it needs

To measure the committed model (`measure`): Node 20 or later, `ffmpeg` on the PATH (or `FFMPEG`), and LibriSpeech
test-clean in the scratch folder. To make it again (`prepare`, `train`, `calibrate`), also:

- `espeak-ng` on the PATH (or `ESPEAK_NG`);
- LibriSpeech train-clean-100 and dev-clean (CC BY 4.0) beside test-clean;
- Coqui's VCTK VITS voice;
- a Python 3.11 venv with PyTorch for the CPU and coqui-tts.

Each is fetched once, into the scratch root (`~/.cache/voice-kit-wake-spike`):

```sh
R=~/.cache/voice-kit-wake-spike
mkdir -p $R/dl/librispeech $R/dl/coqui
cd $R/dl/librispeech
for f in train-clean-100 dev-clean test-clean; do
  curl -LO https://openslr.elda.org/resources/12/$f.tar.gz && tar xzf $f.tar.gz   # makes LibriSpeech/<part>
done
cd $R/dl/coqui
curl -LO https://github.com/coqui-ai/TTS/releases/download/v0.6.1_models/tts_models--en--vctk--vits.zip
python3 -c "import zipfile; zipfile.ZipFile('tts_models--en--vctk--vits.zip').extractall('.')"
cd $R
uv venv --python 3.11 venv
uv pip install --python venv/bin/python --index-url https://download.pytorch.org/whl/cpu torch==2.8.0+cpu torchaudio==2.8.0+cpu
uv pip install --python venv/bin/python --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match coqui-tts six numpy
```

The VITS checkpoint is a downloaded PyTorch file. `vits_say.py` reads it only with PyTorch's `weights_only` loader,
which reads tensors and runs no code from the file, and it runs as `python -I`.

## Where it keeps things

Everything the probe makes stays in `~/.cache/voice-kit-wake-spike/route-d`, outside the repo:

- the sayings (`sayings/`, `vits/`);
- the features of the training audio (`feat/`, about 2 GB);
- `model-trained.json`, the network before its threshold is set.

To use another scratch root, pass `--root DIR` or set `WAKE_PROBE_ROOT`. To use another Python, set
`WAKE_PROBE_PYTHON`. You may delete the scratch folder at any time. Nothing in it is committed. To make one part
again, delete its file: `sayings/<name>.json`, `feat/stream.json` or `feat/meta.json`.

## How to run it

From the repo root, one step at a time, at low priority. Each step is one process, with at most 4 threads.

```sh
nice -n 10 node scripts/wake-probe/probe.mjs prepare     # about 40 min the first time
nice -n 10 node scripts/wake-probe/probe.mjs train       # about 15 min
nice -n 10 node scripts/wake-probe/probe.mjs calibrate   # about 20 min; writes the committed model
node scripts/wake-probe/probe.mjs measure                # about 20 min; reads only the committed model
```

For the car's microphone, run `prepare-hf` after `prepare` and before `train` (three processes that may run together,
about 50 min at low priority; `train.py` uses the hands-free features when all three parts are there):

```sh
for part in stream pos neg; do nice -n 10 node scripts/wake-probe/probe.mjs prepare-hf --part $part & done; wait
```

1. `prepare` makes the audio, then turns it into the network's features with `detector.mjs`:
   - sayings of 'Hey Lampas' by espeak-ng voices and by the VCTK VITS voice's training speakers;
   - their sayings of near words and sentences;
   - 50 hours of LibriSpeech train-clean-100 speech, cut into 20 s stretches. Each stretch is left as it is, put in a
     room's echo, put under road-like noise, or both;
   - 20 minutes of road-like noise alone and 5 minutes of near-quiet;
   - the held-out sayings of the threshold and measuring sets;
   - the test's fixture saying (`fixtures/hey-lampas.wav`).

   The road-like noise and the room's echo are made by `probe.mjs` itself, from no recording.
2. `train` runs `train.py`. It trains a network of three 1-D convolutions and two dense layers on 1.6 s windows. Each
   epoch adds 100,000 fresh windows of the training speech. Three times it mines the training speech for the windows
   the network takes for the phrase, and adds the worst as negatives (hard-negative mining).
3. `calibrate` sets the rule on the threshold set: the lowest threshold, for 2 or 3 windows in a row, that keeps false
   wakes at or under 0.5 an hour on the threshold speech. Of those, it keeps the one with the fewer threshold misses.
   It writes `examples/wake-spike/public/models/hey-lampas.json`.
4. `measure` runs the committed model on the measuring set and prints a table with the Governor's bar beside each
   number, met or not met. Add `--markdown` for the table as markdown. It reports:
   - false wakes, and false wakes an hour, over all of test-clean;
   - misses in sets of 20 held-out sayings: clean, under speech at 10 dB and at 0 dB, and under road-like noise at 5 dB;
   - the delay from the phrase's end to the wake, median and worst;
   - the model's bytes.

The exit code:

- `measure`: 0 when the bar is met, 1 when it is not;
- every step: 2 on an error, for example a missing tool or folder.

## The three sets

The sets are kept apart by speaker and by voice:

| Set | Speech (false wakes) | Sayings of 'Hey Lampas' |
|---|---|---|
| Train | LibriSpeech train-clean-100, 251 speakers | 66 VCTK VITS speakers; espeak-ng en-gb, en-us, en-gb-scotland, en-gb-x-gbclan, en-gb-x-rp, en-gb-x-gbcwmd with 16 variants |
| Threshold | LibriSpeech dev-clean, 40 speakers | 20 other VCTK VITS speakers, 3 sayings each; espeak-ng en-us-nyc, and the m8, klatt5, Andy and Annie variants |
| Measure | LibriSpeech test-clean, 40 speakers | 21 other VCTK VITS speakers, 2 sayings each; espeak-ng en-029, and the m4, f4 and klatt4 variants |

LibriSpeech's parts share no speaker. One more VCTK speaker spoke the test's fixture saying and is in no set.
`probe.mjs` picks the VCTK speakers with a fixed seed, and writes them to `route-d/sets.json`.

## The car's microphone

In the Governor's car the page heard 13 and then 9 of 20 tries (mw-rdpwdp1.4): while the page listens the car switches
to the Bluetooth hands-free profile, and its own microphone reaches the phone as a call. `handsfree.mjs` models that
chain, in this order:

1. the microphone hears the voice, road noise (`roadDb` dB under the voice) and the Bible leaking back from the car's
   speakers (`leakDb`; negative means the Bible is louder than the voice). These levels are at the microphone, before
   the car's processing;
2. the car's noise suppressor, a spectral gate: it tracks each frequency's steady floor, cuts what is not over it, and
   so clips quiet tails and weak consonants (`suppress`);
3. automatic gain to a level of its own, up to 30 dB (`agc`);
4. the link. Narrowband: 300 Hz high-pass, 8 kHz, low-pass at 3.4 kHz, CVSD (64 kbit/s), back up to 16 kHz as the
   phone's resampler does (`linkNarrow`; a quarter of the training cars use a cheap linear resampler that leaves
   images above 4 kHz). Wideband: 80 Hz to 7 kHz and mSBC through FFmpeg's SBC encoder and decoder (`linkWide`, `msbc`).

It is a model of kinds of car, not a recording of one: the suppressor's and the gain's settings are drawn afresh for
every clip. CVSD is written from the Bluetooth parameters (see `licences.json` for where they were read); mSBC is
FFmpeg's. What the Governor's own car sends is not known; `mw-rdpwdp1.11` records it, and a recording is the better
test when there is one.

The held-out set is `HANDSFREE_CONDITIONS`: each link clean, with road noise at 10 and at 0 dB, with the Bible at 0 and
at -10 dB, and with road noise at 5 dB and the Bible at -5 dB. `measure` puts the measuring set's sayings through all
twelve (the Bible stand-in is test-clean speech) and test-clean speech through the car, narrowband and wideband, for
false wakes. The page's `scripts/measure.mjs` does the same with its 20 espeak-ng tries and the cached Bible audio.
Training uses wider levels than the held-out set (road 20 down to -3 dB, the Bible 12 dB under to 12 dB over the
voice), 4 windows of each saying, 11,290 negative windows and 21 h of speech, all through random cars, beside the plain data.

## Tests

`probe.test.mjs` runs in the root `npm test`, or alone with `npx vitest run scripts/wake-probe`. It needs no network,
no tool and no scratch folder, and takes seconds. It checks:

- the front end and the rule;
- that `detector.mjs` imports nothing;
- that the committed model and `licences.json` say what they must;
- that the committed model hears the fixture saying (a VCTK speaker it never trained on) exactly once;
- that it does not hear `packages/testing/clips/english.wav`, nor 30 s of silence;
- the document's tables.
