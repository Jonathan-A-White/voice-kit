// voice-kit/testing's honest speech synthesiser, put on the test window and run on a clock the test moves by hand
// (the same arrangement Postern's tests use), so real timers keep working. `advance(ms)` moves the clock; `finish()` lets
// what is speaking end and the next sentence begin.
import { installSpeech, type Clock, type FakeVoice, type SpeechFake } from 'voice-kit/testing/speech';

export interface ManualClock extends Clock {
  advance(ms: number): void;
}

export function manualClock(): ManualClock {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout: (fn, ms) => {
      next += 1;
      timers.set(next, { at: now + Math.max(0, ms), fn });
      return next;
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        let due: [number, { at: number; fn: () => void }] | null = null;
        for (const entry of timers) if (entry[1].at <= until && (!due || entry[1].at < due[1].at)) due = entry;
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].fn();
      }
      now = until;
    },
  };
}

/** A voice the phone lists, named by its language. */
export function voiceOf(lang: string): FakeVoice {
  return { voiceURI: lang, name: lang, lang, localService: true, default: false };
}

export interface HonestSpeech extends SpeechFake {
  clock: ManualClock;
  advance(ms: number): void;
  /** Lets the sentence that is speaking (or about to) end, and the next one begin. */
  finish(): void;
  /** The sentences still to be heard: speaking, or queued behind it. */
  waiting(): string[];
}

export interface HonestSpeechOptions {
  /** What the phone lists once its voices load. Default: voice-kit's English and Greek voices. */
  voices?: FakeVoice[];
  /** Leave the voice list empty (as a phone is just after the page opens); `advance(50)` loads it. Default: loaded at once. */
  voicesLate?: boolean;
}

export function installHonestSpeech(options: HonestSpeechOptions = {}): HonestSpeech {
  const clock = manualClock();
  const fake = installSpeech(window, { clock, ...(options.voices ? { voices: options.voices } : {}) });
  if (!options.voicesLate) clock.advance(fake.options.voicesDelayMs);
  return Object.assign(fake, {
    clock,
    advance: (ms: number) => clock.advance(ms),
    finish() {
      const target = fake.log.find((entry) => entry.outcome === 'speaking' || entry.outcome === 'queued');
      if (!target) return;
      for (let spent = 0; target.outcome !== 'ended' && spent < 60_000; spent += 10) clock.advance(10);
      clock.advance(0);
    },
    waiting: () => fake.log.filter((entry) => entry.outcome === 'speaking' || entry.outcome === 'queued').map((entry) => entry.text),
  });
}
