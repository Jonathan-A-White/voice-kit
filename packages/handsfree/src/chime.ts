// chime.ts: the two chimes, made with WebAudio from no file. Open is short and soft and rising ('speak now'): two sine notes,
// 220 ms in all, at a peak gain of 0.15. Close is lower and falling ('it has stopped listening'): every note of it is below
// every note of open. Each note has its own gain envelope (a 10 ms rise, then a fall to silence) and the notes never overlap,
// so the peak is never more than one note's.
//
// createChimes makes the AudioContext on first use. Its ready() says whether audio can sound now: a page that has had no touch
// (opened by Google Assistant, say) has a suspended context whose resume() never settles until a touch, and then the session's
// state is needs-touch rather than a wake that pretends to listen.

export interface ChimeNote {
  /** The pitch in Hz. */
  frequency: number;
  /** When it starts, in seconds from the chime's start. */
  at: number;
  /** How long it sounds, in seconds. */
  length: number;
}

export interface ChimeShape {
  notes: ChimeNote[];
  /** The gain each note rises to (at most 0.2 for open). */
  peak: number;
}

/** Rising G5 to C6, 220 ms. */
export const OPEN_CHIME: ChimeShape = {
  peak: 0.15,
  notes: [
    { frequency: 784, at: 0, length: 0.09 },
    { frequency: 1047, at: 0.1, length: 0.12 },
  ],
};

/** Falling E5 to A4, lower than every note of open. */
export const CLOSE_CHIME: ChimeShape = {
  peak: 0.15,
  notes: [
    { frequency: 659, at: 0, length: 0.12 },
    { frequency: 440, at: 0.13, length: 0.2 },
  ],
};

const RISE_S = 0.01;
const SILENT = 0.0001;

/** Plays `shape` on `context` now. Nothing when the context is not running (a suspended one would play it late, at the touch). */
export function playChime(context: AudioContext, shape: ChimeShape): void {
  if (context.state !== 'running') return;
  const t0 = context.currentTime;
  for (const note of shape.notes) {
    const start = t0 + note.at;
    const end = start + note.length;
    const osc = context.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(note.frequency, start);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(shape.peak, start + RISE_S);
    gain.gain.exponentialRampToValueAtTime(SILENT, end);
    osc.connect(gain);
    gain.connect(context.destination);
    osc.start(start);
    osc.stop(end);
  }
}

export interface ChimesOptions {
  /** The context to play on; default a new AudioContext, made on first use (undefined when the page has none). */
  context?: () => AudioContext | undefined;
  /** How long ready() waits for a suspended context to resume. Default 300 ms. */
  readyWaitMs?: number;
  /** Other shapes, if the app wants its own. */
  open?: ChimeShape;
  close?: ChimeShape;
}

export interface Chimes {
  open(): void;
  close(): void;
  /** True when audio can sound now (or the page has no WebAudio at all, which the wake will report); false until a touch. */
  ready(): Promise<boolean>;
}

const newContext = (): AudioContext | undefined => {
  const Ctor = (globalThis as { AudioContext?: new () => AudioContext }).AudioContext;
  return typeof Ctor === 'function' ? new Ctor() : undefined;
};

/** The chimes on one AudioContext, made when first needed. */
export function createChimes(options: ChimesOptions = {}): Chimes {
  const make = options.context ?? newContext;
  const waitMs = options.readyWaitMs ?? 300;
  let context: AudioContext | undefined;
  let made = false;
  const get = (): AudioContext | undefined => {
    if (!made) {
      made = true;
      try {
        context = make();
      } catch {
        context = undefined;
      }
    }
    return context;
  };
  const play = (shape: ChimeShape) => {
    const c = get();
    if (!c) return;
    try {
      playChime(c, shape);
    } catch {
      // a chime that cannot sound is not worth a failure
    }
  };
  return {
    open: () => play(options.open ?? OPEN_CHIME),
    close: () => play(options.close ?? CLOSE_CHIME),
    async ready() {
      const c = get();
      if (!c) return true;
      if (c.state === 'running') return true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.resolve(c.resume()).catch(() => undefined),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, waitMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      return (c.state as string) === 'running';
    },
  };
}
