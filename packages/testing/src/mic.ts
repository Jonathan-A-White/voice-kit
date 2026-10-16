// An honest microphone for an app's tests: navigator.mediaDevices.getUserMedia, MediaRecorder and (webkit)SpeechRecognition
// that behave like Android Chrome in time. getUserMedia hands over a stream that plays a WAV clip in real time (an English
// and a Greek one are committed: see clips); MediaRecorder hands over chunks as it records and what is left on stop();
// the recogniser opens after a moment, sends interim results word by word as the clip plays and a final one at its end,
// and ends after 1.5 s of silence. Options make the input silent (nothing for 3 s, as a Bluetooth headset can be) or the
// permission denied (NotAllowedError).
//
// installMic(target) puts the fakes on a window (vitest: the jsdom window, or globalThis; fake timers move it).
// micInitScript(options) is the same code as a string for Playwright's page.addInitScript, with the clip inside it, where
// the page's own timers (real, or Playwright's page.clock) move it. No DOM lib is needed: the target is handed in.
import { english, greek } from './clips.js';
import type { Clock } from './speech.js';

export type { Clock } from './speech.js';

/** A recorded voice and what it says. `wavBase64` is a PCM WAV file, base64 (so it can travel in an init script). */
export interface Clip {
  name: string;
  /** The language the words are in. */
  lang: string;
  /** What the clip says; the recogniser hears these words, spread over the clip's length. */
  transcript: string;
  wavBase64: string;
}

/** The two committed clips (see the README's Credits): espeak-ng's speech, 16 kHz mono 16-bit. */
export const clips: { english: Clip; greek: Clip } = { english, greek };

/** What the clip's WAV header says, as the fake reads it. */
export interface ClipInfo {
  name: string;
  lang: string;
  transcript: string;
  sampleRate: number;
  channels: number;
  durationMs: number;
}

/** Default for `silent: true`: a Bluetooth headset can say nothing for this long. */
export const SILENT_INPUT_MS = 3000;

export interface MicOptions {
  /** What the microphone hears. Default: clips.english. */
  clip?: Clip;
  /** The input says nothing for a while before the clip: `true` is 3000 ms, a number is that many ms, `Infinity` is for good. Default false. */
  silent?: boolean | number;
  /** The permission is refused: getUserMedia rejects with NotAllowedError and the recogniser errors 'not-allowed'. Default false. */
  denied?: boolean;
  /** Defaults to the global timers and Date. Cannot go into an init script (the page's own clock is used there). */
  clock?: Clock;
  /** How long getUserMedia takes to answer. Default 100. */
  grantMs?: number;
  /** How long the recogniser takes to open after start(); Android Chrome takes 200 to 400. Default 300. */
  openMs?: number;
  /** How long after the clip ends the recogniser ends. Default 1500. */
  silenceMs?: number;
  /** How long a recogniser hears nothing before it errors 'no-speech'. Default 8000. */
  noSpeechMs?: number;
  /**
   * What MediaRecorder says its output is. Default 'audio/webm;codecs=opus', Android Chrome's: the bytes are then the stream's raw
   * PCM, which no browser decodes. 'audio/wav' makes them a real WAV file (header and PCM) that an <audio> element plays, and
   * makes isTypeSupported('audio/wav') true (it is false on Chrome).
   */
  recorderType?: string;
  /** The input's name in the track and in enumerateDevices. */
  label?: string;
}

/** The options as they stand while installed; change one on the handle (`mic.options.denied = true`) and the next call sees it. */
export type MicConfig = Required<Omit<MicOptions, 'clock'>> & { clock: Clock };

/** The options as an init script can carry them: everything but the clock. */
export type MicScriptOptions = Omit<MicOptions, 'clock'>;

export interface FakeEvent {
  type: string;
  target: unknown;
}
export type Listener<E extends FakeEvent = FakeEvent> = (event: E) => void;

export interface FakeTrack {
  readonly kind: 'audio';
  readonly id: string;
  label: string;
  enabled: boolean;
  readonly muted: boolean;
  readonly readyState: 'live' | 'ended';
  onended: Listener | null;
  stop(): void;
  clone(): FakeTrack;
  getSettings(): { deviceId: string; sampleRate: number; channelCount: number };
  addEventListener(type: string, listener: Listener): void;
  removeEventListener(type: string, listener: Listener): void;
}

export interface FakeStream {
  readonly id: string;
  readonly active: boolean;
  getTracks(): FakeTrack[];
  getAudioTracks(): FakeTrack[];
  getVideoTracks(): FakeTrack[];
  getTrackById(id: string): FakeTrack | null;
  addTrack(track: FakeTrack): void;
  removeTrack(track: FakeTrack): void;
  clone(): FakeStream;
  /** Ms since the stream opened. */
  elapsedMs(): number;
  /** Where the clip has got to, 0 to its length, in ms. */
  positionMs(): number;
  /** Is the clip being heard right now (not before a silent input's silence is over, not after the clip's end)? */
  readonly playing: boolean;
  /** The 16-bit PCM the input produced between two times, in ms since the stream opened; silence where the clip is not playing. */
  read(fromMs: number, toMs: number): Uint8Array;
}

export interface RecorderEvent extends FakeEvent {
  data: Blob;
}

export interface FakeRecorder {
  readonly stream: FakeStream;
  readonly mimeType: string;
  readonly state: 'inactive' | 'recording' | 'paused';
  onstart: Listener | null;
  onstop: Listener | null;
  onpause: Listener | null;
  onresume: Listener | null;
  onerror: Listener | null;
  ondataavailable: Listener<RecorderEvent> | null;
  start(timeslice?: number): void;
  stop(): void;
  pause(): void;
  resume(): void;
  requestData(): void;
  addEventListener(type: string, listener: Listener<never>): void;
  removeEventListener(type: string, listener: Listener<never>): void;
}

export interface FakeRecorderConstructor {
  new (stream: FakeStream, options?: { mimeType?: string; audioBitsPerSecond?: number }): FakeRecorder;
  isTypeSupported(type: string): boolean;
}

export interface RecognitionAlternative {
  transcript: string;
  confidence: number;
}
export interface RecognitionResult extends ArrayLike<RecognitionAlternative> {
  readonly isFinal: boolean;
  item(index: number): RecognitionAlternative;
}
export interface RecognitionResultList extends ArrayLike<RecognitionResult> {
  item(index: number): RecognitionResult;
}
export interface RecognitionEvent extends FakeEvent {
  resultIndex: number;
  results: RecognitionResultList;
  /** On error events: 'not-allowed', 'no-speech', 'audio-capture' or 'aborted'. */
  error?: string;
  message?: string;
}

export interface FakeRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: Listener | null;
  onaudiostart: Listener | null;
  onsoundstart: Listener | null;
  onspeechstart: Listener | null;
  onspeechend: Listener | null;
  onsoundend: Listener | null;
  onaudioend: Listener | null;
  onnomatch: Listener | null;
  onend: Listener | null;
  onresult: Listener<RecognitionEvent> | null;
  onerror: Listener<RecognitionEvent> | null;
  /** Chrome lets the recogniser listen on a given audio track; an ended track is an 'audio-capture' error. */
  start(track?: FakeTrack): void;
  stop(): void;
  abort(): void;
  addEventListener(type: string, listener: Listener<never>): void;
  removeEventListener(type: string, listener: Listener<never>): void;
}

export interface FakeRecognitionConstructor {
  new (): FakeRecognition;
}

export interface MicFake {
  /** navigator.mediaDevices.getUserMedia, as installed. */
  getUserMedia(constraints?: unknown): Promise<FakeStream>;
  MediaRecorder: FakeRecorderConstructor;
  SpeechRecognition: FakeRecognitionConstructor;
  /** The options, live. */
  options: MicConfig;
  /** What the current clip's header says. */
  readonly clip: ClipInfo;
  /** Every stream, recorder and recogniser made, and every set of constraints asked for, in order. */
  streams: FakeStream[];
  recorders: FakeRecorder[];
  recognitions: FakeRecognition[];
  requests: unknown[];
  /** Puts back what install replaced and stops the fake's timers. */
  uninstall(): void;
}

/**
 * Installs the fakes on `target` (default: the global object) and returns them. `options.clip` must be given here
 * (installMic below fills in the English clip). This function must stay self-contained: micInitScript() sends its source to a page.
 */
function mountMic(target: object, options: MicOptions & { clip: Clip }): MicFake {
  type Obj = Record<string, unknown>;
  const host = target as Obj;
  const config: MicConfig = {
    clip: options.clip,
    silent: options.silent ?? false,
    denied: options.denied ?? false,
    grantMs: options.grantMs ?? 100,
    openMs: options.openMs ?? 300,
    silenceMs: options.silenceMs ?? 1500,
    noSpeechMs: options.noSpeechMs ?? 8000,
    recorderType: options.recorderType ?? 'audio/webm;codecs=opus',
    label: options.label ?? 'Default - Fake microphone',
    clock: options.clock ?? {
      now: () => Date.now(),
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
  };
  const clock = config.clock;
  const silentMs = () => (config.silent === true ? 3000 : config.silent === false ? 0 : Math.max(0, config.silent));
  const wholeMs = (ms: number) => Math.max(0, Math.round(ms));

  const domError = (name: string, message: string): Error => {
    const Ctor = (host.DOMException ?? globalThis.DOMException) as (new (message: string, name: string) => Error) | undefined;
    return Ctor ? new Ctor(message, name) : Object.assign(new Error(message), { name });
  };

  // The clip: the WAV read once.
  interface Wav {
    info: ClipInfo;
    pcm: Uint8Array;
    frameBytes: number;
    bits: number;
  }
  const wavs = new WeakMap<Clip, Wav>();
  const wavOf = (clip: Clip): Wav => {
    const known = wavs.get(clip);
    if (known) return known;
    const text = atob(clip.wavBase64);
    const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    let sampleRate = 16000;
    let channels = 1;
    let bits = 16;
    let start = 44;
    let end = bytes.length;
    for (let at = 12; at + 8 <= bytes.length; ) {
      const id = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
      const size = view.getUint32(at + 4, true);
      if (id === 'fmt ') {
        channels = view.getUint16(at + 10, true);
        sampleRate = view.getUint32(at + 12, true);
        bits = view.getUint16(at + 22, true);
      } else if (id === 'data') {
        start = at + 8;
        end = Math.min(bytes.length, at + 8 + size);
        break;
      }
      at += 8 + size + (size & 1);
    }
    const pcm = bytes.subarray(start, end);
    const frameBytes = channels * (bits / 8);
    const durationMs = wholeMs((pcm.length / frameBytes / sampleRate) * 1000);
    const wav = { info: { name: clip.name, lang: clip.lang, transcript: clip.transcript, sampleRate, channels, durationMs }, pcm, frameBytes, bits };
    wavs.set(clip, wav);
    return wav;
  };

  class Emitter {
    #listeners: Record<string, Listener[]> = {};
    addEventListener(type: string, listener: Listener) {
      const list = (this.#listeners[type] ??= []);
      if (!list.includes(listener)) list.push(listener);
    }
    removeEventListener(type: string, listener: Listener) {
      this.#listeners[type] = (this.#listeners[type] ?? []).filter((l) => l !== listener);
    }
    dispatchEvent(event: FakeEvent) {
      const handler = (this as unknown as Obj)['on' + event.type];
      if (typeof handler === 'function') handler.call(this, event);
      for (const listener of [...(this.#listeners[event.type] ?? [])]) listener.call(this, event);
      return true;
    }
    emit(type: string, extra: Obj = {}) {
      this.dispatchEvent({ type, target: this, ...extra });
    }
  }

  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${++counter}`;

  class Track extends Emitter {
    readonly kind = 'audio' as const;
    readonly id = nextId('track');
    label = config.label;
    enabled = true;
    muted = false;
    readyState: 'live' | 'ended' = 'live';
    onended: Listener | null = null;
    stop() {
      this.readyState = 'ended';
    }
    clone() {
      return new Track();
    }
    getSettings() {
      return { deviceId: 'default', sampleRate: wavOf(config.clip).info.sampleRate, channelCount: 1 };
    }
  }

  class Stream extends Emitter {
    readonly id = nextId('stream');
    #tracks: Track[] = [new Track()];
    #openedAt = clock.now();
    #clip = config.clip;
    #silence = silentMs();
    get active() {
      return this.#tracks.some((t) => t.readyState === 'live');
    }
    getTracks() {
      return [...this.#tracks];
    }
    getAudioTracks() {
      return [...this.#tracks];
    }
    getVideoTracks() {
      return [];
    }
    getTrackById(id: string) {
      return this.#tracks.find((t) => t.id === id) ?? null;
    }
    addTrack(track: Track) {
      if (!this.#tracks.includes(track)) this.#tracks.push(track);
    }
    removeTrack(track: Track) {
      this.#tracks = this.#tracks.filter((t) => t !== track);
    }
    clone() {
      return new Stream();
    }
    elapsedMs() {
      return clock.now() - this.#openedAt;
    }
    /** The 44-byte header of a PCM WAV file of this stream's format; `dataBytes` is the data's length, or null when it is not yet known (sizes 0xFFFFFFFF, as a streamed WAV says). */
    wavHeader(dataBytes: number | null) {
      const wav = wavOf(this.#clip);
      const out = new Uint8Array(44);
      const view = new DataView(out.buffer);
      const tag = (at: number, text: string) => [...text].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
      tag(0, 'RIFF');
      view.setUint32(4, dataBytes === null ? 0xffffffff : 36 + dataBytes, true);
      tag(8, 'WAVEfmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, wav.info.channels, true);
      view.setUint32(24, wav.info.sampleRate, true);
      view.setUint32(28, wav.info.sampleRate * wav.frameBytes, true);
      view.setUint16(32, wav.frameBytes, true);
      view.setUint16(34, wav.bits, true);
      tag(36, 'data');
      view.setUint32(40, dataBytes === null ? 0xffffffff : dataBytes, true);
      return out;
    }
    positionMs() {
      const wav = wavOf(this.#clip);
      return Math.min(wav.info.durationMs, Math.max(0, this.elapsedMs() - this.#silence));
    }
    get playing() {
      const at = this.elapsedMs() - this.#silence;
      return at >= 0 && at < wavOf(this.#clip).info.durationMs;
    }
    read(fromMs: number, toMs: number) {
      const wav = wavOf(this.#clip);
      const rate = wav.info.sampleRate;
      const frameOf = (ms: number) => Math.floor((ms * rate) / 1000);
      const first = frameOf(fromMs);
      const last = Math.max(first, frameOf(toMs));
      const out = new Uint8Array((last - first) * wav.frameBytes);
      if (Number.isFinite(this.#silence)) {
        const shift = frameOf(this.#silence);
        const total = wav.pcm.length / wav.frameBytes;
        const from = Math.max(first - shift, 0);
        const to = Math.min(last - shift, total);
        if (to > from) out.set(wav.pcm.subarray(from * wav.frameBytes, to * wav.frameBytes), (from + shift - first) * wav.frameBytes);
      }
      return out;
    }
  }

  const streams: Stream[] = [];
  const requests: unknown[] = [];
  const timers = new Set<unknown>();
  const later = (ms: number, fn: () => void) => {
    const handle = clock.setTimeout(() => {
      timers.delete(handle);
      fn();
    }, ms);
    timers.add(handle);
    return handle;
  };
  const cancel = (handle: unknown) => {
    clock.clearTimeout(handle);
    timers.delete(handle);
  };

  class MediaDevices extends Emitter {
    getUserMedia(constraints?: { audio?: unknown; video?: unknown }) {
      requests.push(constraints);
      return new Promise<Stream>((resolve, reject) => {
        if (!constraints || (!constraints.audio && !constraints.video)) {
          reject(new TypeError("Failed to execute 'getUserMedia' on 'MediaDevices': At least one of audio and video must be requested"));
          return;
        }
        later(config.grantMs, () => {
          if (config.denied) reject(domError('NotAllowedError', 'Permission denied'));
          else if (!constraints.audio) reject(domError('NotFoundError', 'Requested device not found'));
          else {
            const stream = new Stream();
            streams.push(stream);
            resolve(stream);
          }
        });
      });
    }
    enumerateDevices() {
      return Promise.resolve([{ deviceId: 'default', kind: 'audioinput', label: config.label, groupId: 'fake-microphone' }]);
    }
    getSupportedConstraints() {
      return {};
    }
  }

  // MediaRecorder
  const isWav = (type: string) => /^audio\/(x-)?wav(e)?(;|$)/i.test(type);
  const recorders: Recorder[] = [];
  class Recorder extends Emitter {
    static isTypeSupported(type: string) {
      return !type || /^audio\/webm(;|$)/i.test(type) || (isWav(config.recorderType) && isWav(type));
    }
    readonly stream: Stream;
    readonly mimeType: string;
    state: 'inactive' | 'recording' | 'paused' = 'inactive';
    onstart: Listener | null = null;
    onstop: Listener | null = null;
    onpause: Listener | null = null;
    onresume: Listener | null = null;
    onerror: Listener | null = null;
    ondataavailable: Listener<RecorderEvent> | null = null;
    #cursor = 0;
    #slice = 0;
    #sliceTimer: unknown = null;
    constructor(stream: Stream, recorderOptions: { mimeType?: string } = {}) {
      super();
      if (!(stream instanceof Stream)) throw new TypeError("Failed to construct 'MediaRecorder': parameter 1 is not of type 'MediaStream'.");
      if (recorderOptions.mimeType && !Recorder.isTypeSupported(recorderOptions.mimeType)) {
        throw domError('NotSupportedError', `MIME type ${recorderOptions.mimeType} is not supported`);
      }
      this.stream = stream;
      this.mimeType = recorderOptions.mimeType || config.recorderType;
      recorders.push(this);
    }
    #sent = false;
    // A WAV recording is one file whose chunks are cut from it: the first chunk carries the header. When that chunk is also the
    // last (no timeslice, or stop() before the first slice), the header says the true length; otherwise the length is not yet
    // known and the header says so, as a streamed WAV does, which decoders read to the end of the file.
    #send(fromMs: number, toMs: number, last = false) {
      const BlobCtor = (host.Blob ?? globalThis.Blob) as typeof Blob;
      const pcm = this.stream.read(fromMs, toMs);
      const parts: Uint8Array[] = isWav(this.mimeType) && !this.#sent ? [this.stream.wavHeader(last ? pcm.length : null), pcm] : [pcm];
      this.#sent = true;
      this.emit('dataavailable', { data: new BlobCtor(parts, { type: this.mimeType }) });
    }
    #flush() {
      const to = this.stream.elapsedMs();
      const from = this.#cursor;
      this.#cursor = to;
      this.#send(from, to);
    }
    #schedule() {
      if (!this.#slice) return;
      this.#sliceTimer = later(this.#slice, () => {
        this.#flush();
        this.#schedule();
      });
    }
    #unschedule() {
      if (this.#sliceTimer !== null) cancel(this.#sliceTimer);
      this.#sliceTimer = null;
    }
    start(timeslice?: number) {
      if (this.state !== 'inactive') throw domError('InvalidStateError', "Failed to execute 'start' on 'MediaRecorder': The MediaRecorder's state is '" + this.state + "'.");
      this.state = 'recording';
      this.#cursor = this.stream.elapsedMs();
      this.#slice = timeslice && timeslice > 0 ? timeslice : 0;
      later(0, () => this.emit('start'));
      this.#schedule();
    }
    stop() {
      if (this.state === 'inactive') throw domError('InvalidStateError', "Failed to execute 'stop' on 'MediaRecorder': The MediaRecorder's state is 'inactive'.");
      const wasPaused = this.state === 'paused';
      this.state = 'inactive';
      this.#unschedule();
      const from = this.#cursor;
      const to = wasPaused ? from : this.stream.elapsedMs();
      later(0, () => {
        this.#send(from, to, true);
        this.emit('stop');
      });
    }
    pause() {
      if (this.state !== 'recording') return;
      this.state = 'paused';
      this.#unschedule();
      this.#flush();
      later(0, () => this.emit('pause'));
    }
    resume() {
      if (this.state !== 'paused') return;
      this.state = 'recording';
      this.#cursor = this.stream.elapsedMs();
      this.#schedule();
      later(0, () => this.emit('resume'));
    }
    requestData() {
      if (this.state === 'inactive') throw domError('InvalidStateError', "Failed to execute 'requestData' on 'MediaRecorder': The MediaRecorder's state is 'inactive'.");
      this.#flush();
    }
  }

  // SpeechRecognition
  const recognitions: Recognition[] = [];
  const resultList = (finals: boolean, transcript: string): RecognitionResultList => {
    const alt: RecognitionAlternative = { transcript, confidence: finals ? 0.9 : 0 };
    const result = Object.assign([alt], { isFinal: finals, item: (i: number) => [alt][i] });
    return Object.assign([result], { item: (i: number) => [result][i] }) as unknown as RecognitionResultList;
  };
  class Recognition extends Emitter {
    lang = '';
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    onstart: Listener | null = null;
    onaudiostart: Listener | null = null;
    onsoundstart: Listener | null = null;
    onspeechstart: Listener | null = null;
    onspeechend: Listener | null = null;
    onsoundend: Listener | null = null;
    onaudioend: Listener | null = null;
    onnomatch: Listener | null = null;
    onend: Listener | null = null;
    onresult: Listener<RecognitionEvent> | null = null;
    onerror: Listener<RecognitionEvent> | null = null;
    #state: 'idle' | 'starting' | 'listening' = 'idle';
    #pending: unknown[] = [];
    #heard = 0;
    #words: string[] = [];
    constructor() {
      super();
      recognitions.push(this);
    }
    #at(ms: number, fn: () => void) {
      this.#pending.push(later(ms, fn));
    }
    #clear() {
      this.#pending.forEach(cancel);
      this.#pending = [];
    }
    #finish() {
      this.#state = 'idle';
      this.#clear();
      this.emit('end');
    }
    #fail(error: string, message: string, audioOpen: boolean) {
      this.#clear();
      if (audioOpen) this.emit('audioend');
      this.emit('error', { error, message });
      this.#finish();
    }
    #result(final: boolean, count: number) {
      this.emit('result', { resultIndex: 0, results: resultList(final, this.#words.slice(0, count).join(' ')) });
    }
    start(track?: { readyState?: string }) {
      if (this.#state !== 'idle') throw domError('InvalidStateError', 'recognition has already started');
      this.#state = 'starting';
      this.#heard = 0;
      this.#words = wavOf(config.clip).info.transcript.split(/\s+/).filter(Boolean);
      this.#at(config.openMs, () => this.#open(track));
    }
    #open(track?: { readyState?: string }) {
      if (config.denied) return this.#fail('not-allowed', 'Permission denied', false);
      if (track && track.readyState === 'ended') return this.#fail('audio-capture', 'The audio track has ended', false);
      this.#state = 'listening';
      this.emit('start');
      this.emit('audiostart');
      const wav = wavOf(config.clip);
      const quiet = silentMs();
      if (!Number.isFinite(quiet) || quiet >= config.noSpeechMs) {
        this.#at(config.noSpeechMs, () => this.#fail('no-speech', 'No speech was detected', true));
        return;
      }
      // Each word ends at its share of the clip, by its length.
      const weights = this.#words.map((w) => w.length + 1);
      const total = weights.reduce((a, b) => a + b, 0);
      const last = this.#words.length;
      let sum = 0;
      this.#at(quiet, () => {
        this.emit('soundstart');
        this.emit('speechstart');
      });
      weights.forEach((w, i) => {
        sum += w;
        const endsAt = i + 1 === last ? wav.info.durationMs : wholeMs((wav.info.durationMs * sum) / total);
        if (i + 1 < last) {
          this.#at(quiet + endsAt, () => {
            this.#heard = i + 1;
            if (this.interimResults) this.#result(false, i + 1);
          });
        }
      });
      this.#at(quiet + wav.info.durationMs, () => {
        this.#heard = last;
        this.emit('speechend');
        if (last > 0) this.#result(true, last);
        this.#heard = -1; // the final is out
        this.#at(config.silenceMs, () => {
          this.emit('soundend');
          this.emit('audioend');
          this.#finish();
        });
      });
    }
    stop() {
      if (this.#state === 'idle') return;
      const listening = this.#state === 'listening';
      const heard = this.#heard;
      this.#clear();
      if (!listening) {
        this.#at(0, () => this.#finish());
        return;
      }
      this.#at(100, () => {
        if (heard > 0) this.#result(true, heard);
        this.emit('audioend');
        this.#finish();
      });
    }
    abort() {
      if (this.#state === 'idle') return;
      const listening = this.#state === 'listening';
      this.#clear();
      this.#at(0, () => this.#fail('aborted', 'aborted', listening));
    }
  }

  // Put the fakes on the target, remembering what was there.
  const restores: (() => void)[] = [];
  const put = (on: object, key: string, value: unknown) => {
    const before = Object.getOwnPropertyDescriptor(on, key);
    Object.defineProperty(on, key, { value, configurable: true, writable: true, enumerable: true });
    restores.unshift(() => {
      if (before) Object.defineProperty(on, key, before);
      else delete (on as Obj)[key];
    });
  };
  if (host.navigator === undefined || host.navigator === null) put(host, 'navigator', {});
  put(host.navigator as object, 'mediaDevices', new MediaDevices());
  put(host, 'MediaRecorder', Recorder);
  put(host, 'SpeechRecognition', Recognition);
  put(host, 'webkitSpeechRecognition', Recognition);

  const registry = (host.__bsvKitTesting ?? {}) as Obj;

  const fake: MicFake = {
    getUserMedia: (constraints) => ((host.navigator as Obj).mediaDevices as MediaDevices).getUserMedia(constraints as never) as unknown as Promise<FakeStream>,
    MediaRecorder: Recorder as unknown as FakeRecorderConstructor,
    SpeechRecognition: Recognition as unknown as FakeRecognitionConstructor,
    options: config,
    get clip() {
      return wavOf(config.clip).info;
    },
    streams: streams as unknown as FakeStream[],
    recorders: recorders as unknown as FakeRecorder[],
    recognitions: recognitions as unknown as FakeRecognition[],
    requests,
    uninstall() {
      [...timers].forEach(cancel);
      restores.splice(0).forEach((restore) => restore());
      delete registry.mic;
      if (Object.keys(registry).length === 0) delete host.__bsvKitTesting;
    },
  };
  registry.mic = fake;
  host.__bsvKitTesting = registry;
  return fake;
}

/** Installs the honest microphone on `target` (default: the global object) and returns its handle. */
export function installMic(target: object = globalThis, options: MicOptions = {}): MicFake {
  return mountMic(target, { ...options, clip: options.clip ?? clips.english });
}

/**
 * The fakes as a string for Playwright: `await page.addInitScript(micInitScript({ clip: clips.greek }))`. It installs on the
 * page's global object before the page's own scripts run, with the clip inside the string; reach the handle from the test with
 * `page.evaluate(() => window.__bsvKitTesting.mic.options.denied = true)`.
 */
export function micInitScript(options: MicScriptOptions = {}): string {
  const given = { ...options, clip: options.clip ?? clips.english };
  const json = JSON.stringify(given, (_key, value) => (value === Infinity ? '__Infinity__' : value)).replace(/"__Infinity__"/g, 'Infinity');
  return `(${mountMic.toString()})(globalThis, ${json});`;
}
