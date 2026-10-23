// Doubles for the composer's tests: the browser's speech recogniser, the phone's audio inputs, MediaRecorder,
// and a transcriber the test drives by hand. Lifted from Postern's features/steps/composer-hold-to-talk.steps.tsx
// and tests/unit/useHold.test.ts.
import { vi } from 'vitest';
import type { ListenError, ListenOptions, ListenResult, Transcriber } from '../../src/index.js';

/** The browser's speech recogniser: it opens its mic at once and hears what a test says. */
export class FakeRecognizer {
  static instances: FakeRecognizer[] = [];
  /** On letting go the recogniser's last result is blank, after words were shown (mw-f7gmps.3). */
  static blankFinal = false;
  /**
   * 'unavailable': Chrome on Android (mw-hgtlf5.1), where processLocally is offered but never honoured: an on-device start answers
   * language-not-supported a moment later (the browser's check), opens no microphone, never ends, and a stop() before the answer does nothing.
   */
  static onDevice: 'works' | 'unavailable' = 'works';
  lang = '';
  continuous = false;
  interimResults = false;
  processLocally = false;
  onstart: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onresult: ((event: { results: unknown[] }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  started = false;
  aborted = false;
  startedWith: { label: string } | undefined = undefined;
  start(track?: { label: string }) {
    this.startedWith = track;
    FakeRecognizer.instances.push(this);
    if (this.processLocally && FakeRecognizer.onDevice === 'unavailable') {
      queueMicrotask(() => this.onerror?.({ error: 'language-not-supported' }));
      return;
    }
    this.started = true;
    queueMicrotask(() => this.onaudiostart?.());
  }
  stop() {
    if (!this.started) return;
    queueMicrotask(() => {
      if (FakeRecognizer.blankFinal) this.onresult?.({ results: [[{ transcript: '' }]] });
      this.onend?.();
    });
  }
  abort() {
    this.aborted = true;
  }
  hear(text: string) {
    this.onresult?.({ results: [[{ transcript: text }]] });
  }
}

export function installRecognizer(): void {
  FakeRecognizer.instances = [];
  FakeRecognizer.blankFinal = false;
  FakeRecognizer.onDevice = 'works';
  vi.stubGlobal('SpeechRecognition', FakeRecognizer);
  Object.defineProperty(navigator, 'vibrate', { value: vi.fn(() => true), configurable: true, writable: true });
}

/** The devices getUserMedia opened, in order: an id, or undefined for the default microphone. */
export const opened: (string | undefined)[] = [];

/** The phone's audio inputs (mw-f7gmps.1): these are listed, and opening one by its id gives a track named after it. */
export function setInputs(inputs: { deviceId: string; label: string }[]): void {
  opened.length = 0;
  const mediaDevices = {
    enumerateDevices: () => Promise.resolve(inputs.map((input) => ({ ...input, kind: 'audioinput' }))),
    getUserMedia: (constraints: { audio: { deviceId?: { exact: string } } | boolean }) => {
      const wanted = typeof constraints.audio === 'object' ? constraints.audio.deviceId?.exact : undefined;
      opened.push(wanted);
      const track = { label: inputs.find((input) => input.deviceId === wanted)?.label ?? 'default', stop: () => {}, clone: () => ({ ...track }) };
      return Promise.resolve({ getAudioTracks: () => [track], getTracks: () => [track] });
    },
  };
  Object.defineProperty(navigator, 'mediaDevices', { value: mediaDevices, configurable: true, writable: true });
}

export function clearInputs(): void {
  opened.length = 0;
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true, writable: true });
}

/** MediaRecorder: records three bytes of webm, whatever it is given. */
export class FakeMediaRecorder {
  static isTypeSupported = () => true;
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = 'recording';
  }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }) });
    this.onstop?.();
  }
}

export class FakeMediaStream {
  private readonly held: unknown[];
  constructor(held: unknown[]) {
    this.held = held;
  }
  getTracks() {
    return this.held;
  }
  getAudioTracks() {
    return this.held;
  }
}

/** A transcriber the test drives: it says the mic is open when told, yields words, and settles on stop. */
export function fakeTranscriber() {
  let options: ListenOptions | undefined;
  let text = '';
  const transcriber: Transcriber & {
    started: number;
    open(): void;
    yields(words: string): void;
    stopped: boolean;
    aborted: boolean;
    /** Given, the release says a stretch of the hold could not be made out (the result's missed and missedNote). */
    missedNote?: string;
    /** The options the last start was given. */
    options?: ListenOptions;
    /** The recogniser fails: the hold's onError. */
    fails(error: ListenError): void;
  } = {
    started: 0,
    stopped: false,
    aborted: false,
    supported: () => true,
    start(given) {
      options = given;
      transcriber.options = given;
      text = '';
      transcriber.started += 1;
      transcriber.stopped = false;
      transcriber.aborted = false;
      return {
        ok: true,
        session: {
          mode: 'on-device',
          stop: (): Promise<ListenResult> => {
            transcriber.stopped = true;
            const missed = transcriber.missedNote ? { missed: true as const, missedNote: transcriber.missedNote } : {};
            return Promise.resolve({ ok: true, text, mode: 'on-device', ...missed });
          },
          abort: () => {
            transcriber.aborted = true;
          },
        },
      };
    },
    open() {
      options?.onStart?.();
    },
    fails(error: ListenError) {
      options?.onError?.(error);
    },
    yields(words: string) {
      text = words;
      options?.onInterim?.(words);
    },
  };
  return transcriber;
}
