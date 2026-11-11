// The spike page: Play streams John 1 through whatever output the phone uses (the car's Bluetooth included); Listen opens
// the chosen input and shows its track label, settings and a level meter; the log keeps what happened and Copy results
// puts it on the clipboard. No wake word here: the question is whether opening a microphone drops the car's sound to call quality.
import { listInputs, openInput, startMeter } from './inputs.js';
import type { OpenedInput } from './inputs.js';
import { createLog } from './log.js';

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

let storage: Storage | undefined;
try {
  storage = window.localStorage;
} catch {
  storage = undefined;
}
const log = createLog(storage);
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

function setListening(on: boolean): void {
  listenButton.disabled = on;
  stopButton.disabled = !on;
  select.disabled = on;
}

function endListening(): void {
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
  setListening(true);
  status.textContent = 'Opening…';
  void (async () => {
    try {
      const input = await openInput(media, deviceId);
      opened = input;
      trackLabel.textContent = input.label || '(no label)';
      trackSettings.textContent = JSON.stringify(input.settings, null, 2);
      log.add('input-opened', { label: input.label, settings: input.settings });
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
