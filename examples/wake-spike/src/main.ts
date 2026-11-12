// The spike page: Play streams John 1 through whatever output the phone uses (the car's Bluetooth included); Listen opens
// the chosen input and shows its track label, settings and a level meter; the log keeps what happened and Copy results
// puts it on the clipboard. The first question is whether opening a microphone drops the car's sound to call quality; the
// second is whether a small model can hear 'Hey Lampas' on the page: Listen also feeds the input to the wake detector
// (a worklet and a Web Worker, capture.ts) and shows what it hears, what it costs and the headless numbers.
import { startCapture } from './capture.js';
import type { Capture } from './capture.js';
import type { DetectorStats, Wake, WakeModel } from './detector.js';
import { listInputs, openInput, startMeter } from './inputs.js';
import type { OpenedInput } from './inputs.js';
import { createLog } from './log.js';
import { createRecorder } from './recording.js';
import type { Recorder } from './recording.js';
import { summarize } from './results.js';
import type { Results } from './results.js';
import { downloadFiles, sendFiles } from './share.js';
import { describeTries, readTries, saveTries } from './tries.js';

const JOHN_1 = 'https://openbible.com/audio/msb/MSB_43_Jhn_001_D.mp3';

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const player = byId<HTMLAudioElement>('player');
const playButton = byId<HTMLButtonElement>('play');
const pauseButton = byId<HTMLButtonElement>('pause');
const namesButton = byId<HTMLButtonElement>('names');
const select = byId<HTMLSelectElement>('input');
const listenButton = byId<HTMLButtonElement>('listen');
const stopButton = byId<HTMLButtonElement>('stop');
const level = byId<HTMLMeterElement>('level');
const status = byId<HTMLElement>('status');
const trackLabel = byId<HTMLElement>('track-label');
const trackSettings = byId<HTMLElement>('track-settings');
const copyButton = byId<HTMLButtonElement>('copy');
const clearButton = byId<HTMLButtonElement>('clear');
const copied = byId<HTMLElement>('copied');
const logView = byId<HTMLElement>('log');
const heard = byId<HTMLElement>('heard');
const triesText = byId<HTMLElement>('tries-text');
const triesWakes = document.querySelector<HTMLElement>('[data-testid="tries-wakes"]') as HTMLElement;
const triesMinutes = document.querySelector<HTMLElement>('[data-testid="tries-minutes"]') as HTMLElement;
const resetTries = byId<HTMLButtonElement>('reset-tries');
const recordToggle = byId<HTMLInputElement>('record-tries');
const markMiss = byId<HTMLButtonElement>('mark-miss');
const sendRecording = byId<HTMLButtonElement>('send-recording');
const recordStatus = byId<HTMLElement>('record-status');
const compute = document.querySelector<HTMLElement>('[data-testid="compute"]') as HTMLElement;
const modelBytes = document.querySelector<HTMLElement>('[data-testid="model-bytes"]') as HTMLElement;
const headless = byId<HTMLElement>('headless');

// The model file, next to the page (public/models). The headless numbers are bundled if scripts/measure.mjs has written them.
const MODEL_URL = 'models/hey-lampas.json';
const bundled = import.meta.glob<Results>('../results.json', { eager: true, import: 'default' });
headless.textContent = summarize(Object.values(bundled)[0]);

let storage: Storage | undefined;
try {
  storage = window.localStorage;
} catch {
  storage = undefined;
}
const log = createLog(storage);
let tries = readTries(storage);
function showTries(): void {
  triesText.textContent = describeTries(tries);
  triesWakes.textContent = String(tries.wakes);
  triesMinutes.textContent = (tries.seconds / 60).toFixed(2);
  saveTries(storage, tries);
}
showTries();
resetTries.addEventListener('click', () => {
  tries = { wakes: 0, seconds: 0 };
  heardSeconds = 0;
  showTries();
  log.add('tries-reset');
});
byId<HTMLElement>('hint').textContent = 'Input names show once the microphone is allowed: tap "Show input names".';
const media = navigator.mediaDevices as MediaDevices | undefined;

function showLog(): void {
  logView.textContent = log
    .entries()
    .map((entry) => `${entry.time.slice(11, 19)} ${entry.event}${entry.detail ? ' ' + JSON.stringify(entry.detail) : ''}`)
    .join('\n');
  logView.scrollTop = logView.scrollHeight;
}
log.onChange(showLog);
showLog();

const message = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));

// Play
playButton.addEventListener('click', () => {
  if (!player.src || player.src !== JOHN_1) player.src = JOHN_1;
  log.add('play', { src: JOHN_1 });
  player.play().catch((err: unknown) => log.add('play-failed', { error: message(err) }));
});
pauseButton.addEventListener('click', () => {
  player.pause();
  log.add('pause', { at: Math.round(player.currentTime) });
});
player.addEventListener('error', () => log.add('audio-error', { code: player.error?.code ?? null, message: player.error?.message ?? '' }));

// Inputs
async function refreshInputs(): Promise<void> {
  const chosen = select.value;
  let devices: MediaDeviceInfo[] = [];
  try {
    devices = (await media?.enumerateDevices()) ?? [];
  } catch (err) {
    log.add('list-failed', { error: message(err) });
  }
  select.replaceChildren(
    ...listInputs(devices).map((choice) => {
      const option = document.createElement('option');
      option.value = choice.value;
      option.textContent = choice.label;
      return option;
    }),
  );
  if ([...select.options].some((option) => option.value === chosen)) select.value = chosen;
}

namesButton.addEventListener('click', () => {
  // Names come only once the microphone is allowed: take the permission with a brief look at the default input.
  void (async () => {
    try {
      (await media?.getUserMedia({ audio: true }))?.getTracks().forEach((each) => each.stop());
      log.add('allowed');
    } catch (err) {
      log.add('allow-failed', { error: message(err) });
    }
    await refreshInputs();
  })();
});

media?.addEventListener('devicechange', () => {
  log.add('devicechange');
  void refreshInputs();
});

// Listen
let opened: OpenedInput | undefined;
let stopMeter: (() => void) | undefined;
let capture: Capture | undefined;
let heardSeconds = 0; // audio the detector has reported in this listen, so tries.seconds grows by the difference
let model: { value: WakeModel; bytes: number } | undefined;

/** The model, fetched once per page: its JSON and the bytes it came as. */
async function fetchModel(): Promise<{ value: WakeModel; bytes: number }> {
  if (model) return model;
  const response = await fetch(MODEL_URL);
  if (!response.ok) throw new Error(`the model did not load: ${response.status}`);
  const buffer = await response.arrayBuffer();
  model = { value: JSON.parse(new TextDecoder().decode(buffer)) as WakeModel, bytes: buffer.byteLength };
  modelBytes.textContent = model.bytes.toLocaleString('en-GB');
  log.add('model-fetched', { url: MODEL_URL, bytes: model.bytes });
  return model;
}

function onWake(wake: Wake): void {
  const clock = new Date().toTimeString().slice(0, 8);
  heard.textContent = `Heard Hey Lampas at ${clock} (${wake.time.toFixed(1)} s of listening, score ${wake.score.toFixed(3)})`;
  tries = { ...tries, wakes: tries.wakes + 1 };
  showTries();
  if (recordingNow) recorder?.markWake(wake);
  log.add('wake', { at: Number(wake.time.toFixed(3)), score: Number(wake.score.toFixed(4)) });
}

function onStats(stats: DetectorStats): void {
  compute.textContent = stats.msPerSecond.toFixed(2);
  tries = { ...tries, seconds: tries.seconds + (stats.audioSeconds - heardSeconds) };
  heardSeconds = stats.audioSeconds;
  showTries();
}

function setListening(on: boolean): void {
  listenButton.disabled = on;
  stopButton.disabled = !on;
  select.disabled = on;
  recordToggle.disabled = on;
  if (!on) recordingNow = false;
  showRecording();
}

// Record my tries: the input audio of a listen, as the page received it, kept in memory only (recording.ts) until Send
// recording is tapped. A listen with the toggle on starts a new recording in place of the last one.
let recorder: Recorder | undefined;
let recordingNow = false; // this listen is being recorded
let recordInput: { label: string; settings: unknown } = { label: '', settings: {} };
let shownSecond = -1;

function showRecording(note?: string): void {
  markMiss.disabled = !(recordingNow && recorder);
  sendRecording.disabled = !recorder || recorder.seconds() <= 0;
  if (note) recordStatus.textContent = note;
  else if (recordingNow) recordStatus.textContent = `Recording: ${Math.floor(recorder?.keptSeconds() ?? 0)} s kept (the last 10 minutes at most). Tap "Stop listening" when done.`;
  else if (recorder && recorder.seconds() > 0) recordStatus.textContent = `Recorded ${recorder.keptSeconds().toFixed(1)} s. Tap "Send recording" to send it.`;
  else recordStatus.textContent = recordToggle.checked ? 'Record my tries is on: tap "Listen" to start recording; tap "Mark a miss" for a try that did not wake.' : 'Not recording.';
}
showRecording();
recordToggle.addEventListener('change', () => {
  log.add(recordToggle.checked ? 'record-on' : 'record-off');
  showRecording();
});

function onInput(samples: Float32Array, inputRate: number): void {
  if (!recordingNow) return;
  recorder ??= createRecorder(inputRate);
  recorder.add(samples);
  const second = Math.floor(recorder.seconds());
  if (second !== shownSecond) {
    shownSecond = second;
    showRecording();
  }
}

markMiss.addEventListener('click', () => {
  recorder?.markMiss();
  log.add('miss-marked', { at: Number((recorder?.seconds() ?? 0).toFixed(3)) });
  showRecording('Marked a miss.');
});

sendRecording.addEventListener('click', () => {
  if (!recorder) return;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  const files = [
    new File([recorder.toWav()], `hey-lampas-tries-${stamp}.wav`, { type: 'audio/wav' }),
    new File([JSON.stringify(recorder.tryLog(recordInput), null, 2)], `hey-lampas-tries-${stamp}.json`, { type: 'application/json' }),
  ];
  const seconds = recorder.keptSeconds().toFixed(1);
  void sendFiles(files, navigator as unknown as Parameters<typeof sendFiles>[1], downloadFiles).then((how) => {
    log.add('recording-sent', { how, seconds: Number(seconds), files: files.map((file) => file.name) });
    if (how === 'shared') showRecording(`Shared ${seconds} s of audio and the try log with the share sheet.`);
    else if (how === 'downloaded') showRecording(`This browser cannot share files: downloaded ${files.map((file) => file.name).join(' and ')} (${seconds} s of audio).`);
    else showRecording('Share cancelled: nothing was sent.');
  });
});

function endListening(): void {
  capture?.stop();
  capture = undefined;
  stopMeter?.();
  stopMeter = undefined;
  opened?.close();
  opened = undefined;
  level.value = 0;
  setListening(false);
}

listenButton.addEventListener('click', () => {
  if (!media) {
    status.textContent = 'This browser has no microphone access.';
    log.add('listen-failed', { error: 'no mediaDevices' });
    return;
  }
  const deviceId = select.value;
  const choice = select.selectedOptions[0]?.textContent ?? 'Default';
  log.add('listen', { input: choice, deviceId: deviceId || null });
  recordingNow = recordToggle.checked;
  if (recordingNow) {
    recorder = undefined;
    shownSecond = -1;
    recordInput = { label: '', settings: {} };
  }
  setListening(true);
  status.textContent = 'Opening…';
  heardSeconds = 0;
  const modelReady = fetchModel();
  modelReady.catch(() => undefined); // reported below, once the input is open
  void (async () => {
    try {
      const input = await openInput(media, deviceId);
      opened = input;
      trackLabel.textContent = input.label || '(no label)';
      trackSettings.textContent = JSON.stringify(input.settings, null, 2);
      log.add('input-opened', { label: input.label, settings: input.settings });
      recordInput = { label: input.label, settings: input.settings };
      input.track.addEventListener('ended', () => {
        log.add('track-ended', { label: input.label });
        status.textContent = 'The input ended by itself.';
        endListening();
      });
      input.track.addEventListener('mute', () => {
        log.add('track-muted', { label: input.label });
        status.textContent = 'The input is muted by the system.';
      });
      input.track.addEventListener('unmute', () => {
        log.add('track-unmuted', { label: input.label });
        status.textContent = 'Listening. Tap "Stop listening" when done.';
      });
      stopMeter = startMeter(input.stream, (value) => {
        level.value = value;
      });
      status.textContent = 'Listening. Tap "Stop listening" when done.';
      await refreshInputs();
      // The detector is the second question: if it cannot start, the input stays open and the first question is still answered.
      try {
        const loaded = await modelReady;
        const started = await startCapture(input.stream, loaded.value, { onWake, onStats, onInput, onError: (error) => log.add('wake-error', { error }) });
        if (opened === input) {
          capture = started;
          log.add('detector-started', { inputRate: started.inputRate, bytes: loaded.bytes });
          heard.textContent = 'Listening for "Hey Lampas".';
        } else started.stop();
      } catch (err) {
        log.add('detector-failed', { error: message(err) });
        heard.textContent = `The wake detector could not start: ${message(err)}`;
      }
    } catch (err) {
      log.add('listen-failed', { error: message(err) });
      status.textContent = `Could not open the input: ${message(err)}`;
      endListening();
    }
  })();
});

stopButton.addEventListener('click', () => {
  const label = opened?.label;
  endListening();
  log.add('stop', { label: label ?? null });
  status.textContent = 'Not listening.';
});

// Log
copyButton.addEventListener('click', () => {
  const text = log.toJson();
  void (async () => {
    try {
      await navigator.clipboard.writeText(text);
      copied.textContent = 'Copied.';
    } catch {
      // No clipboard permission: show the JSON selected so it can be copied by hand.
      logView.textContent = text;
      const range = document.createRange();
      range.selectNodeContents(logView);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      copied.textContent = 'Copy blocked: the log is selected below, copy it by hand.';
    }
  })();
});
clearButton.addEventListener('click', () => {
  log.clear();
  copied.textContent = '';
});

void refreshInputs();
