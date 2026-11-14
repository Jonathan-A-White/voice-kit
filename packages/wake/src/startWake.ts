// startWake: the one call an app makes. It opens the default microphone (getUserMedia with audio: true, the browser's own
// settings) unless it is given a stream, loads the model, starts the capture and calls onWake for each wake. Every failure
// is a value with a kind, never a throw.
import { startCapture } from './capture.js';
import type { DetectorStats, Wake, WakeModel } from './detector.js';

export type WakeFailureKind = 'not-supported' | 'permission-denied' | 'no-microphone' | 'other';

export interface WakeOptions {
  /** Called for each wake. */
  onWake(wake: Wake): void;
  /** The parsed model JSON (dist/models/hey-lampas.json). Give this or modelUrl. */
  model?: WakeModel;
  /** Where to fetch the model JSON from, when `model` is not given. */
  modelUrl?: string;
  /** A microphone stream you already hold. startWake then opens nothing and stop() leaves its tracks to you. */
  stream?: MediaStream;
  /** About once per second of audio: what the detector has cost so far. */
  onStats?(stats: DetectorStats): void;
  /** Each batch of samples as the browser captured them (before resampling); copy what you keep. */
  onInput?(samples: Float32Array, inputRate: number): void;
  /** A failure after the start, from the worker. */
  onError?(message: string): void;
  /** The fetch to load modelUrl with (a test's, say); defaults to the global one. */
  fetch?: typeof fetch;
}

export interface WakeFailure {
  ok: false;
  kind: WakeFailureKind;
  message: string;
}

export interface RunningWake {
  ok: true;
  /** Ends the worker and the audio context, and the microphone track when startWake opened it. Safe to call twice. */
  stop(): void;
  /** The open microphone track (the stream's first audio track). */
  track: MediaStreamTrack;
  /** The stream the microphone gave (or you did). */
  stream: MediaStream;
  /** The rate the browser captures at, before the worker brings it to 16 kHz. */
  inputRate: number;
  /** The model that is running. */
  model: WakeModel;
}

export type StartWakeResult = RunningWake | WakeFailure;

const failure = (kind: WakeFailureKind, message: string): WakeFailure => ({ ok: false, kind, message });
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The kind of failure a getUserMedia rejection is. */
function openFailure(err: unknown): WakeFailure {
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return failure('permission-denied', 'The microphone was not allowed.');
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return failure('no-microphone', 'There is no microphone to open.');
  return failure('other', messageOf(err));
}

const g = globalThis as { AudioContext?: unknown; AudioWorkletNode?: unknown; Worker?: unknown; navigator?: { mediaDevices?: { getUserMedia?: unknown } } };

/** Listens for the wake word. Resolves once the detector is running, or with the reason it could not be. */
export async function startWake(options: WakeOptions): Promise<StartWakeResult> {
  if (typeof g.AudioContext !== 'function' || typeof g.AudioWorkletNode !== 'function' || typeof g.Worker !== 'function') {
    return failure('not-supported', 'This browser has no AudioWorklet or Web Worker.');
  }
  if (!options.stream && typeof g.navigator?.mediaDevices?.getUserMedia !== 'function') {
    return failure('not-supported', 'This browser cannot open a microphone here (no mediaDevices; a page must be served over https).');
  }

  let model = options.model;
  if (!model) {
    if (!options.modelUrl) return failure('other', 'startWake needs a model or a modelUrl.');
    try {
      const response = await (options.fetch ?? fetch)(options.modelUrl);
      if (!response.ok) return failure('other', `The model did not load: ${response.status}.`);
      model = (await response.json()) as WakeModel;
    } catch (err) {
      return failure('other', `The model did not load: ${messageOf(err)}`);
    }
  }

  let stream = options.stream;
  const opened = !stream;
  if (!stream) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      return openFailure(err);
    }
  }
  const track = stream.getAudioTracks()[0];
  const endTrack = () => {
    if (opened) for (const t of stream.getTracks()) t.stop();
  };
  if (!track) {
    endTrack();
    return failure('no-microphone', 'The stream has no audio track.');
  }

  try {
    const capture = await startCapture(stream, model, {
      onWake: options.onWake,
      onStats: options.onStats ?? (() => undefined),
      onError: options.onError ?? (() => undefined),
      onInput: options.onInput,
    });
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      capture.stop();
      endTrack();
    };
    return { ok: true, stop, track, stream, inputRate: capture.inputRate, model };
  } catch (err) {
    endTrack();
    return failure('other', messageOf(err));
  }
}
