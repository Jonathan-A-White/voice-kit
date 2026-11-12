# Wake spike

A one-page spike for the car. It answers two questions:

1. **When the page opens a microphone, does the car's Bluetooth sound drop to call quality?**
2. **Can a small model hear "Hey Lampas" in the browser alone,** with Bible audio playing, and what does it cost?
   The model is `public/models/hey-lampas.json` (made by `scripts/wake-probe`, see
   [docs/wake-word-engines.md](../../docs/wake-word-engines.md)); the page runs it with no server and no runtime beyond
   the browser.

The page has four parts, all taps:

1. **Play** streams John 1 (the publisher's public download, <https://openbible.com/audio/msb/MSB_43_Jhn_001_D.mp3>)
   through an `<audio>` element, so it plays through whatever output the phone uses, the car's Bluetooth included.
   The element has no `crossorigin` attribute and the page never `fetch()`es the audio.
2. **Listen** opens the input chosen in the **Input** list: "Default" (no device id) or one of the phone's inputs (an
   exact device id). Names appear once the microphone is allowed; **Show input names** takes the permission. The page
   shows the opened track's label and settings, and a level meter, so you can see whether it hears you.
   **Stop listening** closes it.
3. **Hey Lampas**: while it listens, the same input feeds the detector. On a wake the page shows "Heard Hey Lampas at"
   the time, how far into the listening it was, and the score. Below it: a **20 tries** count (wakes heard and minutes
   listened, kept across reloads; **Reset tries** clears it), the compute the detector spends per second of audio, the
   bytes of the model it fetched, and the headless numbers from `results.json` (see Results below).
4. **Log**: every Play, Pause, Listen, input opened, track ended, muted or unmuted, wake, and device change, with the
   time, is kept in localStorage (it survives a reload). **Copy results** copies it as JSON.

How the detector is fed: an AudioWorklet (`src/capture-worklet.js`) takes the microphone's samples off the audio thread;
the page relays them to a Web Worker (`src/worker.ts`) that brings them to 16 kHz (`createResampler`) and runs the
detector (`src/detector.ts`, a TypeScript port of `scripts/wake-probe/detector.mjs`: log-mel front end, a small 1-D
convolutional network, a rule that turns scores into one wake with a 2 s cooldown). The worklet is joined to a silent gain
node and that to the output, because some browsers do not run a worklet that nothing pulls; it adds no sound. The page opens
the microphone with the browser's own settings (echo cancellation and noise suppression as the browser defaults them).

<!-- toc -->

- [The check, in the car](#the-check-in-the-car)
- [Run it locally](#run-it-locally)
- [Measure it](#measure-it)
- [Results](#results)
- [Where it is published](#where-it-is-published)

<!-- /toc -->

## The check, in the car

Parked for the whole check, Bluetooth connected: open the page and tap **Play**; the car plays John 1. Then for
"Default" and then each listed input in turn: tap **Listen**, say a few words, watch the meter; note whether the car's
sound drops to call quality (thin, muffled, or the car's screen shows a call) and whether the meter moved; tap
**Stop listening**; does the sound come back? Then tap **Copy results** and send the log on.

## Run it locally

```sh
npm ci
npm run dev --workspace wake-spike      # http://localhost:5173 (a microphone needs localhost or https)
npm run build --workspace wake-spike    # a static build in examples/wake-spike/dist
npm test -- examples/wake-spike         # the detector, the page in Chromium (fake microphone playing the saying), no network
```

## Measure it

The headless numbers come from two scripts and a third that runs the detector over them. They need `ffmpeg`, `ffprobe`
and `espeak-ng` on the PATH and Chromium for playwright-core; the cache is `~/.cache/voice-kit-wake-spike` (outside the repo,
nothing in it is committed; no audio file but the one small test fixture is).

```sh
node examples/wake-spike/scripts/fetch-bible-audio.mjs       # John in the recorded voice until 60 min are cached, about 30 s
nice -n 10 npm run measure --workspace wake-spike            # about 5 min; writes examples/wake-spike/results.json
```

- `fetch-bible-audio.mjs` is polite: one request at a time, 2 s between files, the User-Agent `voice-kit-wake-spike/1`, a
  file already cached is never fetched again, a network failure is retried twice with a growing wait, and any 4xx or 5xx
  stops it. It downloads the same openbible.com files the page plays.
- `make-tries.mjs` (run by `measure` for any set missing) makes four sets of 20 tries of "Hey Lampas" in 20 espeak-ng voices
  the model never trained on (the unseen voice and variant pairs named in `scripts/wake-probe/README.md`): clean; under
  Bible audio at 10 dB and at 0 dB speech-to-speech; under brown noise, a road proxy, at 5 dB. The 20 sayings are the same
  in every set. Each try is 5 s with the saying at 2 s and its phrase end known. Piper is not on the laptop, so there are no
  Piper tries. It also makes twelve more sets (story mw-rdpwdp1.12) for a car's Bluetooth hands-free microphone: the same 20
  sayings through `scripts/wake-probe/handsfree.mjs` (the car's noise suppressor, automatic gain, and a narrowband
  8 kHz CVSD or wideband mSBC link), each link clean, under brown noise at 10 and 0 dB, with the cached Bible leaking back at
  0 and -10 dB, and with brown noise at 5 dB and the Bible at -5 dB. The dB are the saying over the interferer at the
  microphone, before the car's processing, so -10 is the Bible 10 dB louder than the voice.
- `measure.mjs` runs `src/detector.ts` (transpiled, the code the page runs) over the whole cached Bible audio as one
  stream and counts the wakes; over each set of tries and counts misses and the delay from the phrase end to the wake; sizes
  the model files and their gzip; and times the detector in Node and in headless Chromium with the CPU throttled 4x (CDP
  `Emulation.setCPUThrottlingRate`, a phone proxy). Battery is not measured headless. It also plays the cached Bible
  through the car with nobody talking, narrowband and wideband (road noise under it in three minutes of four), and counts the
  false wakes an hour of each. `--model FILE --out FILE --quick` measures another model file and writes the numbers
  elsewhere without the compute runs: that is how the model before mw-rdpwdp1.12 was measured on the hands-free sets.

## Results

Measured 2026-11-12 at commit `6925864` (the model, `results.json` and this table are the next commit's), headless on
the laptop, by `npm run measure --workspace wake-spike` (17 min 1 s; the numbers are in `results.json`). The targets are the
Governor's bar (question 6, mw-6ww.165), not provisional: at most 1 false wake an hour while the Bible plays, at most 2 misses in 20.
The model is the one retrained for a car's Bluetooth hands-free microphone (mw-rdpwdp1.12, rule threshold 0.924, 3 in a row).

| Measure | Result | Target (the Governor's bar (question 6, mw-6ww.165)) | Met |
|---|---|---|---|
| Bible audio played | 62.0 min of John (10 chapters, recorded voice) | at least 60 min | met |
| False wakes | 0 in 62.0 min | - | - |
| False wakes an hour | 0.00 | at most 1 | met |
| False wakes an hour, Bible through the car, narrowband | 0.97 (1 in 62.0 min) | at most 1 | met |
| False wakes an hour, Bible through the car, wideband | 0.00 (0 in 62.0 min) | at most 1 | met |
| Misses, clean | 0 in 20 | at most 2 in 20 | met |
| Misses, under Bible audio at 10 dB | 0 in 20 | at most 2 in 20 | met |
| Misses, under Bible audio at 0 dB | 0 in 20 | at most 2 in 20 | met |
| Misses, under brown noise (a road proxy) at 5 dB | 0 in 20 | at most 2 in 20 | met |
| Misses, narrowband hands-free, clean | 0 in 20 | at most 2 in 20 | met |
| Misses, narrowband hands-free, road noise at 10 dB | 0 in 20 | at most 2 in 20 | met |
| Misses, narrowband hands-free, road noise at 0 dB | 0 in 20 | at most 2 in 20 | met |
| Misses, narrowband hands-free, Bible leaking at 0 dB | 4 in 20 | at most 2 in 20 | not met |
| Misses, narrowband hands-free, Bible leaking at -10 dB | 8 in 20 | at most 2 in 20 | not met |
| Misses, narrowband hands-free, road noise at 5 dB and Bible leaking at -5 dB | 6 in 20 | at most 2 in 20 | not met |
| Misses, wideband hands-free, clean | 0 in 20 | at most 2 in 20 | met |
| Misses, wideband hands-free, road noise at 10 dB | 0 in 20 | at most 2 in 20 | met |
| Misses, wideband hands-free, road noise at 0 dB | 0 in 20 | at most 2 in 20 | met |
| Misses, wideband hands-free, Bible leaking at 0 dB | 1 in 20 | at most 2 in 20 | met |
| Misses, wideband hands-free, Bible leaking at -10 dB | 9 in 20 | at most 2 in 20 | not met |
| Misses, wideband hands-free, road noise at 5 dB and Bible leaking at -5 dB | 0 in 20 | at most 2 in 20 | met |
| Delay from the phrase end to the wake, median | 83 ms (292 tries that woke) | - | - |
| Delay, worst | 327 ms | - | - |
| Model size | 469,912 bytes, 347,179 gzipped (hey-lampas.json) | - | - |
| Compute in Node | 80.94 ms per second of audio (16 kHz in); 84.68 with 48 kHz in | - | - |
| Compute in Chromium | 109.70 ms per second of audio (48 kHz in, page main thread) | - | - |
| Compute in Chromium, CPU throttled 4x | 431.65 ms per second of audio (a phone proxy) | - | - |
| Battery | not measured: it needs a phone, not a headless run | - | - |

**The model before and after, on the hands-free sets** (the old model, committed at `d0272bc`, measured with
`measure.mjs --model` on the same tries):

| Measure (hands-free, the model before mw-rdpwdp1.12) | Misses before | Misses now |
|---|---|---|
| False wakes an hour, Bible through the car, narrowband | 0.00 (0 in 62.0 min) | 0.97 (1 in 62.0 min) |
| False wakes an hour, Bible through the car, wideband | 0.97 (1 in 62.0 min) | 0.00 (0 in 62.0 min) |
| narrowband hands-free, clean | 15 in 20 | 0 in 20 |
| narrowband hands-free, road noise at 10 dB | 17 in 20 | 0 in 20 |
| narrowband hands-free, road noise at 0 dB | 16 in 20 | 0 in 20 |
| narrowband hands-free, Bible leaking at 0 dB | 17 in 20 | 4 in 20 |
| narrowband hands-free, Bible leaking at -10 dB | 20 in 20 | 8 in 20 |
| narrowband hands-free, road noise at 5 dB and Bible leaking at -5 dB | 19 in 20 | 6 in 20 |
| wideband hands-free, clean | 0 in 20 | 0 in 20 |
| wideband hands-free, road noise at 10 dB | 0 in 20 | 0 in 20 |
| wideband hands-free, road noise at 0 dB | 0 in 20 | 0 in 20 |
| wideband hands-free, Bible leaking at 0 dB | 1 in 20 | 1 in 20 |
| wideband hands-free, Bible leaking at -10 dB | 6 in 20 | 9 in 20 |
| wideband hands-free, road noise at 5 dB and Bible leaking at -5 dB | 2 in 20 | 0 in 20 |

**What the numbers say.** The old model could not hear a narrowband call at all: 15 to 20 of 20 missed even with nothing
else on the line (a call's band stops at 3.4 kHz and the 's' of "Lampas" lives above it), which is the shape of the Governor's
car (13 and 9 woke of 20). Retrained with the car's microphone chain in the data, narrowband is 0 missed in 20 clean and
under road noise at 10 and at 0 dB, and wideband stays 0 in every set it had. What is not done: the Bible leaking back
loud. The target is at most 2 missed in 20 on every set; it is **not met** with the Bible at 0 dB narrowband (4), at -10 dB
narrowband (8) and wideband (9), and with road noise and the Bible together narrowband (6). At -10 dB the Bible is 10 dB
louder than the voice at the microphone before the car's own processing, and this small network (86,817 weights, a 1.6 s
window) does not pull the phrase out of a narrator that much louder. Wideband at -10 dB is also worse than before (6 to 9)
because the threshold had to rise to 0.924 to keep false wakes through a car under 0.5 an hour. False wakes an hour on the
Bible, plain and through the car, narrowband and wideband, are all within the bar (0 or 1 in 62 minutes). The tries are 20
espeak-ng voices, not a person, and the car's chain is a model of kinds of car, not a recording of his: the next real test is
the car demo (mw-rdpwdp1.4), and a recording from "Record my tries" (mw-rdpwdp1.11) would say what his car really sends.
The network is the same size and shape as before (469,912 bytes), so its compute should be what it was; the compute rows above
read higher (81 ms per second in Node against 33) because another measuring run was using the laptop at the same time, so
treat them as an upper bound and not as a change.

## Where it is published

<https://jonathan-a-white.github.io/voice-kit/>

`.github/workflows/wake-spike-pages.yml` builds this folder and publishes it with GitHub's Pages actions on a push to
`main` that touches `examples/wake-spike`. It needs the repository's Settings > Pages > Source set to
"GitHub Actions".
