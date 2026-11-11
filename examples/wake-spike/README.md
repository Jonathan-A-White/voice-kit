# Wake spike

A one-page spike for the car. It answers one question before any wake-word model exists: **when the page opens a
microphone, does the car's Bluetooth sound drop to call quality?** There is no wake word here.

The page has three parts, all taps:

1. **Play** streams John 1 (the publisher's public download, <https://openbible.com/audio/msb/MSB_43_Jhn_001_D.mp3>)
   through an `<audio>` element, so it plays through whatever output the phone uses, the car's Bluetooth included.
   The element has no `crossorigin` attribute and the page never `fetch()`es the audio.
2. **Listen** opens the input chosen in the **Input** list: "Default" (no device id) or one of the phone's inputs (an
   exact device id). Names appear once the microphone is allowed; **Show input names** takes the permission. The page
   shows the opened track's label and settings, and a level meter, so you can see whether it hears you.
   **Stop listening** closes it.
3. **Log**: every Play, Pause, Listen, input opened, track ended, muted or unmuted, and device change, with the time, is
   kept in localStorage (it survives a reload). **Copy results** copies it as JSON.

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
npm test -- examples/wake-spike         # the page in Chromium, with fake media devices and no network
```

## Where it is published

<https://jonathan-a-white.github.io/voice-kit/>

`.github/workflows/wake-spike-pages.yml` builds this folder and publishes it with GitHub's Pages actions on a push to
`main` that touches `examples/wake-spike`. It needs the repository's Settings > Pages > Source set to
"GitHub Actions".
