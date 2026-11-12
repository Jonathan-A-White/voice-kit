// The recording of the tries (mw-rdpwdp1.11). While 'Record my tries' is on, the page keeps the input audio of the listen
// exactly as the page received it (the browser's own processing, and the car's, already applied; before the detector's
// resampling), at most the last ten minutes of it, as 16-bit samples in memory. Nothing is stored on disk and nothing
// is sent: the WAV and the try log are made on demand for Send recording.

/** The most audio kept, in seconds. */
export const MAX_RECORD_SECONDS = 600;

export interface TryMark {
  kind: 'wake' | 'miss';
  /** Seconds of listening when it happened (the detector's own clock for a wake; the audio received so far for a miss). */
  at: number;
  /** The score of a wake. */
  score?: number;
  /** The wall-clock time (ISO). */
  clock: string;
}

export interface TryLog {
  recordedAt: string;
  inputRate: number;
  /** Seconds of input heard in all. */
  listenedSeconds: number;
  /** Where the WAV starts, in seconds of listening: more than 0 only when the oldest audio was dropped to stay within the cap. */
  wavStartsAt: number;
  wavSeconds: number;
  input: { label: string; settings: unknown };
  wakes: number;
  misses: number;
  tries: TryMark[];
}

export interface Recorder {
  /** Keeps these samples (the caller may reuse the array). */
  add(samples: Float32Array): void;
  markWake(wake: { time: number; score: number }): void;
  /** A try he says did not wake, at the audio received so far. */
  markMiss(): void;
  /** Seconds of input heard in all. */
  seconds(): number;
  keptSeconds(): number;
  droppedSeconds(): number;
  /** Mono 16-bit PCM WAV of what is kept. */
  toWav(): Uint8Array<ArrayBuffer>;
  tryLog(input: { label: string; settings: unknown }): TryLog;
}

export function createRecorder(inputRate: number, maxSeconds = MAX_RECORD_SECONDS, now: () => Date = () => new Date()): Recorder {
  const cap = Math.max(1, Math.round(inputRate * maxSeconds));
  const startedAt = now().toISOString();
  const chunks: Int16Array[] = [];
  let kept = 0;
  let total = 0;
  const marks: TryMark[] = [];

  const trim = () => {
    while (kept > cap) {
      const excess = kept - cap;
      const first = chunks[0];
      if (first.length <= excess) {
        chunks.shift();
        kept -= first.length;
      } else {
        chunks[0] = first.subarray(excess);
        kept -= excess;
      }
    }
  };
  const round = (n: number) => Number(n.toFixed(3));
  const seconds = () => total / inputRate;

  return {
    add(samples) {
      const chunk = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const value = Math.max(-1, Math.min(1, samples[i]));
        chunk[i] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
      }
      chunks.push(chunk);
      kept += chunk.length;
      total += chunk.length;
      trim();
    },
    markWake(wake) {
      marks.push({ kind: 'wake', at: round(wake.time), score: Number(wake.score.toFixed(4)), clock: now().toISOString() });
    },
    markMiss() {
      marks.push({ kind: 'miss', at: round(seconds()), clock: now().toISOString() });
    },
    seconds,
    keptSeconds: () => kept / inputRate,
    droppedSeconds: () => (total - kept) / inputRate,
    toWav() {
      const bytes = new Uint8Array(44 + kept * 2);
      const view = new DataView(bytes.buffer);
      const text = (at: number, value: string) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
      text(0, 'RIFF');
      view.setUint32(4, 36 + kept * 2, true);
      text(8, 'WAVEfmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, inputRate, true);
      view.setUint32(28, inputRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      text(36, 'data');
      view.setUint32(40, kept * 2, true);
      let at = 44;
      for (const chunk of chunks) {
        for (let i = 0; i < chunk.length; i++, at += 2) view.setInt16(at, chunk[i], true);
      }
      return bytes;
    },
    tryLog(input) {
      return {
        recordedAt: startedAt,
        inputRate,
        listenedSeconds: round(seconds()),
        wavStartsAt: round((total - kept) / inputRate),
        wavSeconds: round(kept / inputRate),
        input,
        wakes: marks.filter((mark) => mark.kind === 'wake').length,
        misses: marks.filter((mark) => mark.kind === 'miss').length,
        tries: [...marks],
      };
    },
  };
}
