// replay.ts — the words of a recording, made out by the browser's own speech recogniser (mw-q6n8m0.5). When the
// recogniser ends by itself while he holds (Android Chrome on a pause), listen.ts does not start it again, because every
// start rings the phone's start tone: it records the rest of the hold instead, and on release this plays that recording,
// silently, into a fresh recogniser on an audio track (Chrome's start(track)). Only the stretches with sound in them are
// played, back to back, so a long pause in the recording neither ends the recogniser nor makes him wait; a recogniser
// that ends before the audio does is started again (he has let go: no tone rings in a hold). A recording with sound in
// it that gives no words is a failure, said as one, never an empty turn.
import type { Recording } from './recorder.js';

/** The parts of a recognition result read here (TypeScript's DOM lib has no SpeechRecognition types). */
export interface ReplayResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { readonly transcript: string };
}

/** The parts of a SpeechRecognition used here, configured (language, on-device or cloud) by whoever makes it. */
export interface ReplayRecognizer {
  onstart: (() => void) | null;
  onaudiostart: (() => void) | null;
  onresult: ((event: { readonly results: ArrayLike<ReplayResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(audioTrack?: MediaStreamTrack): void;
  stop(): void;
  abort(): void;
}

export interface ReplayOptions {
  /** A fresh recogniser for the recording. */
  recognizer: () => ReplayRecognizer;
  /** The words of the recogniser's results, joined. */
  words: (results: ArrayLike<ReplayResult>) => string;
  /** Aborted, the recogniser is stopped and the replay gives up. */
  signal?: AbortSignal;
}

/** A 50 ms stretch whose RMS level (full scale 1) is above this has sound in it; below, it is silence. */
export const SOUND_LEVEL = 0.02;
const WINDOW_S = 0.05;
/** Kept either side of each stretch of sound, so no word is clipped; stretches closer than twice this are one. */
export const MARGIN_S = 0.3;
/** How long the audio waits for the recogniser to say it is open before it plays anyway. */
export const OPEN_WAIT_MS = 1000;
/** How long past the end of the audio the recogniser has to give its last words before the replay settles with what it has. */
export const REPLAY_SLACK_MS = 5000;
/** How many times a recogniser that ends before the audio does is started again. */
const MAX_REPLAY_STARTS = 3;

/** The stretches of `samples` with sound in them, as [from, to) sample indexes, each with MARGIN_S either side; none when it is all silence. */
export function soundStretches(samples: Float32Array, sampleRate: number): [number, number][] {
  const size = Math.max(1, Math.round(sampleRate * WINDOW_S));
  const margin = Math.round(sampleRate * MARGIN_S);
  const stretches: [number, number][] = [];
  for (let at = 0; at < samples.length; at += size) {
    const end = Math.min(samples.length, at + size);
    let sum = 0;
    for (let i = at; i < end; i++) sum += samples[i] * samples[i];
    if (Math.sqrt(sum / (end - at)) <= SOUND_LEVEL) continue;
    const from = Math.max(0, at - margin);
    const to = Math.min(samples.length, end + margin);
    const last = stretches[stretches.length - 1];
    if (last && from <= last[1]) last[1] = to;
    else stretches.push([from, to]);
  }
  return stretches;
}

/** The stretches of `buffer` with sound in them, back to back in one buffer; undefined when it is all silence. */
function condensed(audio: AudioContext, buffer: AudioBuffer): AudioBuffer | undefined {
  const stretches = soundStretches(buffer.getChannelData(0), buffer.sampleRate);
  if (stretches.length === 0) return undefined;
  const length = stretches.reduce((sum, [from, to]) => sum + to - from, 0);
  const out = audio.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    let at = 0;
    for (const [from, to] of stretches) {
      out.copyToChannel(samples.subarray(from, to), channel, at);
      at += to - from;
    }
  }
  return out;
}

type AudioContextConstructor = new () => AudioContext;

function audioContext(): AudioContextConstructor | undefined {
  const scope = globalThis as unknown as { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor };
  return scope.AudioContext ?? scope.webkitAudioContext;
}

/** Plays `recording` into a fresh recogniser and gives its words: '' for a recording of silence; throws, saying why, when the words cannot be made out. */
export async function replayRecording(recording: Recording, { recognizer: make, words, signal }: ReplayOptions): Promise<string> {
  const Audio = audioContext();
  if (!Audio) throw new Error('this browser cannot play a recording to its speech recogniser');
  const audio = new Audio();
  let track: MediaStreamTrack | undefined;
  try {
    let decoded: AudioBuffer;
    try {
      decoded = await audio.decodeAudioData(await recording.blob.arrayBuffer());
    } catch {
      throw new Error('the recording could not be read');
    }
    const buffer = condensed(audio, decoded);
    if (!buffer) return '';
    if (signal?.aborted) throw new Error('it was dropped');
    const source = audio.createBufferSource();
    source.buffer = buffer;
    const destination = audio.createMediaStreamDestination();
    source.connect(destination);
    const playing = destination.stream.getAudioTracks()[0];
    track = playing;
    const heard = await new Promise<string>((resolve, reject) => {
      const recognizer = make();
      // The words of the recogniser's earlier runs, when it ended before the audio did.
      const before: string[] = [];
      let results: ArrayLike<ReplayResult> = [];
      let failure: string | undefined;
      let played = false;
      let over = false;
      let starts = 1;
      let limit: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        clearTimeout(opening);
        clearTimeout(limit);
        recognizer.onend = null;
        signal?.removeEventListener('abort', cancel);
        if (failure) reject(new Error(failure));
        else resolve([...before, words(results).trim()].filter(Boolean).join(' '));
      };
      const end = () => {
        recognizer.onend = null;
        try {
          recognizer.abort();
        } catch {
          // already ended
        }
        done();
      };
      const cancel = () => {
        failure ??= 'it was dropped';
        end();
      };
      const play = () => {
        if (played) return;
        played = true;
        clearTimeout(opening);
        source.start();
        limit = setTimeout(end, buffer.duration * 1000 + REPLAY_SLACK_MS);
      };
      source.onended = () => {
        over = true;
        try {
          recognizer.stop();
        } catch {
          end();
        }
      };
      recognizer.onstart = recognizer.onaudiostart = play;
      recognizer.onresult = (event) => {
        results = event.results;
      };
      recognizer.onerror = (event) => {
        if (event.error !== 'no-speech' && event.error !== 'aborted') failure ??= `the speech service failed: ${event.error}`;
      };
      recognizer.onend = () => {
        if (over || failure || starts >= MAX_REPLAY_STARTS) return done();
        // It ended before the audio did: keep what it gave and start it again on the same track.
        before.push(words(results).trim());
        results = [];
        starts++;
        try {
          recognizer.start(playing);
        } catch {
          end();
        }
      };
      const opening = setTimeout(play, OPEN_WAIT_MS);
      signal?.addEventListener('abort', cancel);
      try {
        recognizer.start(playing);
      } catch {
        failure = 'the speech service would not take the recording';
        done();
      }
    });
    if (!heard) throw new Error('the speech service made out no words in it');
    return heard;
  } finally {
    track?.stop();
    void audio.close().catch(() => undefined);
  }
}
