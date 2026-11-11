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
  Piper tries.
- `measure.mjs` runs `src/detector.ts` (transpiled, the code the page runs) over the whole cached Bible audio as one
  stream and counts the wakes; over each set of tries and counts misses and the delay from the phrase end to the wake; sizes
  the model files and their gzip; and times the detector in Node and in headless Chromium with the CPU throttled 4x (CDP
  `Emulation.setCPUThrottlingRate`, a phone proxy). Battery is not measured headless.

## Results

Measured 2026-11-11 at commit `5f8b35d`, headless on the laptop, by `npm run measure --workspace wake-spike`
(3 min 55 s; the numbers are in `results.json`). The targets are the Governor's bar (question 6, mw-6ww.165), not provisional:
at most 1 false wake an hour while the Bible plays, at most 2 misses in 20.

| Measure | Result | Target (the Governor's bar (question 6, mw-6ww.165)) | Met |
|---|---|---|---|
| Bible audio played | 62.0 min of John (10 chapters, recorded voice) | at least 60 min | met |
| False wakes | 1 in 62.0 min | - | - |
| False wakes an hour | 0.97 | at most 1 | met |
| Misses, clean | 0 in 20 | at most 2 in 20 | met |
| Misses, under Bible audio at 10 dB | 0 in 20 | at most 2 in 20 | met |
| Misses, under Bible audio at 0 dB | 0 in 20 | at most 2 in 20 | met |
| Misses, under brown noise (a road proxy) at 5 dB | 0 in 20 | at most 2 in 20 | met |
| Delay from the phrase end to the wake, median | 62 ms (80 tries that woke) | - | - |
| Delay, worst | 115 ms | - | - |
| Model size | 469,057 bytes, 346,866 gzipped (hey-lampas.json) | - | - |
| Compute in Node | 32.65 ms per second of audio (16 kHz in); 37.65 with 48 kHz in | - | - |
| Compute in Chromium | 63.82 ms per second of audio (48 kHz in, page main thread) | - | - |
| Compute in Chromium, CPU throttled 4x | 189.58 ms per second of audio (a phone proxy) | - | - |
| Battery | not measured: it needs a phone, not a headless run | - | - |

**What the numbers say.** On this test the bar is met, but the false-wake line is met by a hair: one false wake in 62.0
minutes of John is 0.97 an hour against a limit of 1, so a second one anywhere in the hour would have missed it, and 62 minutes
of one reader's voice is a small sample, not a guarantee. The misses are 0 in every set of 20, but those tries are espeak-ng
voices, synthetic and in the same family as voices the model was trained on in other variants; no human voice, microphone or
car has been tried, so the 20 tries panel on a phone is the real test of the misses. The delay is small (a wake about 62 ms
after the phrase ends, 115 ms at worst). The model is 469,057 bytes (346,866 gzipped), a one-time fetch the page can cache,
and no server, runtime or extra library is needed: a browser-only wake word is possible at this size. The cost that
stands out is compute: 33 to 50 ms of CPU per second of audio in Node over three runs (a few percent of one core), 50 to 64
in desktop Chromium, and 190 to 346 ms per second with the CPU throttled 4x, which is a fifth to a third of a core spent for
as long as the page listens. The runs differ that much from one another because the laptop was shared, and the throttled
number is a proxy for a phone, not a phone. Battery is not measured: it needs a phone, and that fraction of a core is where
to look first. The detector is plain, unoptimised JavaScript (a float FFT and convolutions), so the compute has room to fall.

## Where it is published

<https://jonathan-a-white.github.io/voice-kit/>

`.github/workflows/wake-spike-pages.yml` builds this folder and publishes it with GitHub's Pages actions on a push to
`main` that touches `examples/wake-spike`. It needs the repository's Settings > Pages > Source set to
"GitHub Actions".
