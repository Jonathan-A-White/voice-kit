// replay.ts (mw-q6n8m0.5): the rest of a hold, recorded after the recogniser ended by itself, played on release into a fresh
// recogniser. The page's audio (AudioContext) and the recogniser are doubles the test drives; the clock is vitest's.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { MARGIN_S, OPEN_WAIT_MS, REPLAY_SLACK_MS, replayRecording, soundStretches, type ReplayRecognizer, type ReplayResult } from '../src/replay.js';
import type { Recording } from '../src/recorder.js';

const RATE = 1000;

/** `seconds` of silence (0) or of sound (a square wave at half scale). */
const stretch = (seconds: number, sound: boolean) => Array.from({ length: seconds * RATE }, (_, i) => (sound ? (i % 2 ? 0.5 : -0.5) : 0));
const samples = (...parts: number[][]) => Float32Array.from(parts.flat());

class Buffer {
  readonly channels: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(channel: number) {
    return this.channels[channel];
  }
  copyToChannel(source: Float32Array, channel: number, at: number) {
    this.channels[channel].set(source, at);
  }
}

/** The page's AudioContext: decodes any recording to `Audio.decoded`, and plays a buffer source into a stream destination. */
class Audio {
  static made: Audio[] = [];
  static decoded: Float32Array = new Float32Array(0);
  static decodeFails = false;
  closed = false;
  source?: { buffer: Buffer | null; onended: (() => void) | null; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn> };
  track = { stop: vi.fn() };
  constructor() {
    Audio.made.push(this);
  }
  decodeAudioData() {
    if (Audio.decodeFails) return Promise.reject(new Error('EncodingError'));
    const buffer = new Buffer(1, Audio.decoded.length, RATE);
    buffer.copyToChannel(Audio.decoded, 0, 0);
    return Promise.resolve(buffer);
  }
  createBuffer(channels: number, length: number, rate: number) {
    return new Buffer(channels, length, rate);
  }
  createBufferSource() {
    this.source = { buffer: null, onended: null, connect: vi.fn(), start: vi.fn() };
    return this.source;
  }
  createMediaStreamDestination() {
    return { stream: { getAudioTracks: () => [this.track] } };
  }
  close() {
    this.closed = true;
    return Promise.resolve();
  }
  /** The buffer source plays to its end. */
  played() {
    this.source?.onended?.();
  }
}

/** A recogniser the test drives: what it was started on, how often, and what it says. */
class Recognizer implements ReplayRecognizer {
  onstart: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onresult: ((event: { results: ArrayLike<ReplayResult> }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn<(track?: MediaStreamTrack) => void>();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn(() => this.onend?.());
  hears(...transcripts: string[]) {
    this.onresult?.({ results: transcripts.map((transcript) => ({ isFinal: true, length: 1, 0: { transcript } })) });
  }
}

const recording: Recording = { blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' }), mime: 'audio/webm', durationMs: 4000 };
const words = (results: ArrayLike<ReplayResult>) =>
  Array.from(results, (result) => result[0].transcript)
    .filter(Boolean)
    .join(' ');

function setUp(decoded: Float32Array) {
  Audio.made = [];
  Audio.decoded = decoded;
  Audio.decodeFails = false;
  vi.stubGlobal('AudioContext', Audio);
  const recognizer = new Recognizer();
  return { recognizer, make: vi.fn(() => recognizer) };
}

describe('soundStretches', () => {
  it('finds each stretch with sound, a margin either side, and joins stretches closer than two margins', () => {
    const found = soundStretches(samples(stretch(2, false), stretch(1, true), stretch(0.4, false), stretch(1, true), stretch(5, false), stretch(1, true)), RATE);
    const margin = MARGIN_S * RATE;
    expect(found).toEqual([
      [2000 - margin, 4400 + margin],
      [9400 - margin, 10400],
    ]);
  });

  it('finds none in silence, or in a hiss below the sound level', () => {
    expect(soundStretches(samples(stretch(3, false)), RATE)).toEqual([]);
    expect(soundStretches(Float32Array.from({ length: 3000 }, (_, i) => (i % 2 ? 0.01 : -0.01)), RATE)).toEqual([]);
  });
});

describe('replayRecording', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('plays only the stretches with sound, back to back, into a fresh recogniser on the audio track once it opens, and gives its words', async () => {
    vi.useFakeTimers();
    // A pause of 6 s inside the recording, after the 2 s that open it.
    const { recognizer, make } = setUp(samples(stretch(2, false), stretch(1, true), stretch(6, false), stretch(1, true), stretch(1, false)));
    const replay = replayRecording(recording, { recognizer: make, words });
    await vi.advanceTimersByTimeAsync(0);
    const audio = Audio.made[0];
    expect(make).toHaveBeenCalledTimes(1);
    expect(recognizer.start).toHaveBeenCalledWith(audio.track);
    expect(audio.source?.connect).toHaveBeenCalled();
    expect(audio.source?.start).not.toHaveBeenCalled();
    recognizer.onstart?.();
    expect(audio.source?.start).toHaveBeenCalledTimes(1);
    // Two stretches of 1 s with 0.3 s either side: 3.2 s, not the 11 s recorded.
    expect(audio.source?.buffer?.duration).toBeCloseTo(3.2);
    expect(Array.from(audio.source?.buffer?.getChannelData(0).subarray(300, 304) ?? [])).toEqual([-0.5, 0.5, -0.5, 0.5]);
    recognizer.hears('and this is', 'after the pause');
    audio.played();
    expect(recognizer.stop).toHaveBeenCalled();
    await expect(replay).resolves.toBe('and this is after the pause');
    expect(audio.track.stop).toHaveBeenCalled();
    expect(audio.closed).toBe(true);
  });

  it('gives no words, and starts no recogniser, for a recording of silence', async () => {
    const { make } = setUp(samples(stretch(4, false)));
    await expect(replayRecording(recording, { recognizer: make, words })).resolves.toBe('');
    expect(make).not.toHaveBeenCalled();
    expect(Audio.made[0].closed).toBe(true);
  });

  it(`plays after ${OPEN_WAIT_MS} ms when the recogniser never says it opened`, async () => {
    vi.useFakeTimers();
    const { recognizer, make } = setUp(samples(stretch(1, true)));
    const replay = replayRecording(recording, { recognizer: make, words });
    await vi.advanceTimersByTimeAsync(OPEN_WAIT_MS - 1);
    expect(Audio.made[0].source?.start).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(Audio.made[0].source?.start).toHaveBeenCalledTimes(1);
    recognizer.hears('late');
    Audio.made[0].played();
    await expect(replay).resolves.toBe('late');
  });

  it('starts the recogniser again on the same track when it ends before the audio does, and keeps both parts', async () => {
    vi.useFakeTimers();
    const { recognizer, make } = setUp(samples(stretch(2, true)));
    const replay = replayRecording(recording, { recognizer: make, words });
    await vi.advanceTimersByTimeAsync(0);
    recognizer.onstart?.();
    recognizer.hears('first part');
    recognizer.onend?.();
    expect(recognizer.start).toHaveBeenCalledTimes(2);
    expect(recognizer.start).toHaveBeenLastCalledWith(Audio.made[0].track);
    recognizer.hears('second part');
    Audio.made[0].played();
    await expect(replay).resolves.toBe('first part second part');
  });

  it('says so, never an empty turn, when a recording with sound in it gives no words', async () => {
    vi.useFakeTimers();
    const { recognizer, make } = setUp(samples(stretch(1, true)));
    const replay = replayRecording(recording, { recognizer: make, words });
    const caught = replay.catch((err: Error) => err.message);
    await vi.advanceTimersByTimeAsync(0);
    recognizer.onstart?.();
    recognizer.onerror?.({ error: 'no-speech' });
    Audio.made[0].played();
    expect(await caught).toMatch(/no words/);
  });

  it('names the error when the recogniser fails', async () => {
    vi.useFakeTimers();
    const { recognizer, make } = setUp(samples(stretch(1, true)));
    const caught = replayRecording(recording, { recognizer: make, words }).catch((err: Error) => err.message);
    await vi.advanceTimersByTimeAsync(0);
    recognizer.onstart?.();
    recognizer.hears('half');
    recognizer.onerror?.({ error: 'network' });
    recognizer.onend?.();
    expect(await caught).toBe('the speech service failed: network');
  });

  it('says so when the recogniser will not take the track, or the recording cannot be read, or the page has no AudioContext', async () => {
    const { recognizer, make } = setUp(samples(stretch(1, true)));
    recognizer.start.mockImplementation(() => {
      throw new Error('not a track');
    });
    await expect(replayRecording(recording, { recognizer: make, words })).rejects.toThrow('the speech service would not take the recording');
    Audio.decodeFails = true;
    await expect(replayRecording(recording, { recognizer: make, words })).rejects.toThrow('the recording could not be read');
    vi.unstubAllGlobals();
    await expect(replayRecording(recording, { recognizer: make, words })).rejects.toThrow(/cannot play a recording/);
  });

  it(`settles with the words so far ${REPLAY_SLACK_MS} ms after the audio's end when the recogniser never ends`, async () => {
    vi.useFakeTimers();
    const { recognizer, make } = setUp(samples(stretch(1, true)));
    recognizer.stop.mockImplementation(() => {});
    recognizer.abort.mockImplementation(() => {});
    const replay = replayRecording(recording, { recognizer: make, words });
    await vi.advanceTimersByTimeAsync(0);
    recognizer.onstart?.();
    recognizer.hears('kept');
    Audio.made[0].played();
    await vi.advanceTimersByTimeAsync(1600 + REPLAY_SLACK_MS);
    await expect(replay).resolves.toBe('kept');
    expect(recognizer.abort).toHaveBeenCalled();
  });

  it('stops the recogniser and gives up when the hold is dropped', async () => {
    vi.useFakeTimers();
    const { recognizer, make } = setUp(samples(stretch(1, true)));
    const dropped = new AbortController();
    const caught = replayRecording(recording, { recognizer: make, words, signal: dropped.signal }).catch((err: Error) => err.message);
    await vi.advanceTimersByTimeAsync(0);
    recognizer.onstart?.();
    dropped.abort();
    expect(recognizer.abort).toHaveBeenCalled();
    expect(await caught).toBe('it was dropped');
  });
});
