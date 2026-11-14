// The two chimes (mw-rl10piw.2), made with WebAudio from no file, played into a stub AudioContext that records every note.
import { describe, expect, it } from 'vitest';
import { CLOSE_CHIME, OPEN_CHIME, createChimes, playChime } from 'voice-kit/handsfree';

interface Note {
  frequency: number;
  type: string;
  start: number;
  stop: number;
  /** Every gain the note's envelope reaches (set or ramped to). */
  gains: number[];
}

/** A stub AudioContext: oscillators and gains that record what is asked of them. */
function stubContext(state: 'running' | 'suspended' = 'running') {
  const notes: Note[] = [];
  class Param {
    value = 0;
    constructor(private readonly seen: number[]) {}
    setValueAtTime(v: number) {
      this.value = v;
      this.seen.push(v);
      return this;
    }
    linearRampToValueAtTime(v: number) {
      this.seen.push(v);
      return this;
    }
    exponentialRampToValueAtTime(v: number) {
      this.seen.push(v);
      return this;
    }
    setTargetAtTime(v: number) {
      this.seen.push(v);
      return this;
    }
  }
  const destination = { name: 'destination' };
  const context = {
    state,
    currentTime: 12.5,
    destination,
    resume: async () => {
      context.state = 'running';
    },
    createOscillator() {
      const frequencies: number[] = [];
      const note: Note = { frequency: 0, type: 'sine', start: NaN, stop: NaN, gains: [] };
      const frequency = new Param(frequencies);
      const osc = {
        type: 'sine',
        frequency,
        connect(to: { gainOf?: Note[] }) {
          to.gainOf?.push(note);
          return to;
        },
        start(at = context.currentTime) {
          note.start = at;
          note.type = osc.type;
          note.frequency = frequencies.at(-1) ?? frequency.value;
          notes.push(note);
        },
        stop(at = context.currentTime) {
          note.stop = at;
        },
      };
      return osc;
    },
    createGain() {
      const gainOf: Note[] = [];
      const seen: number[] = [];
      const node = {
        gainOf,
        gain: new Param(seen),
        connect(to: unknown) {
          // the envelope's gains belong to the note(s) joined to this node
          queueMicrotask(() => gainOf.forEach((n) => n.gains.push(...seen)));
          return to;
        },
      };
      return node;
    },
  };
  return { context: context as unknown as AudioContext, notes };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the chimes', () => {
  it('open lasts at most 250 ms with peak gain at most 0.2', async () => {
    const { context, notes } = stubContext();
    playChime(context, OPEN_CHIME);
    await settle();
    expect(notes.length).toBeGreaterThan(0);
    const start = Math.min(...notes.map((n) => n.start));
    const end = Math.max(...notes.map((n) => n.stop));
    expect(start).toBeGreaterThanOrEqual(12.5);
    expect(end - start).toBeLessThanOrEqual(0.25);
    for (const n of notes) {
      expect(n.gains.length).toBeGreaterThan(0);
      expect(Math.max(...n.gains)).toBeLessThanOrEqual(0.2);
      expect(Math.max(...n.gains)).toBeGreaterThan(0);
      expect(n.stop).toBeGreaterThan(n.start);
    }
    // no two notes sound at once, so the gains never add up past the peak
    const sorted = [...notes].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].stop);
  });

  it('every note of close is lower than every note of open', async () => {
    const open = stubContext();
    playChime(open.context, OPEN_CHIME);
    const close = stubContext();
    playChime(close.context, CLOSE_CHIME);
    await settle();
    expect(open.notes.length).toBeGreaterThan(0);
    expect(close.notes.length).toBeGreaterThan(0);
    const lowestOpen = Math.min(...open.notes.map((n) => n.frequency));
    for (const n of close.notes) expect(n.frequency).toBeLessThan(lowestOpen);
    for (const n of close.notes) expect(Math.max(...n.gains)).toBeLessThanOrEqual(0.2);
  });

  it('the shapes say the same as what is played', () => {
    const openEnd = Math.max(...OPEN_CHIME.notes.map((n) => n.at + n.length));
    expect(openEnd).toBeLessThanOrEqual(0.25);
    expect(OPEN_CHIME.peak).toBeLessThanOrEqual(0.2);
    expect(Math.max(...CLOSE_CHIME.notes.map((n) => n.frequency))).toBeLessThan(Math.min(...OPEN_CHIME.notes.map((n) => n.frequency)));
  });

  it('createChimes plays into its context and ready() says whether the audio runs', async () => {
    const running = stubContext();
    const chimes = createChimes({ context: () => running.context });
    expect(await chimes.ready()).toBe(true);
    chimes.open();
    chimes.close();
    await settle();
    expect(running.notes.length).toBe(OPEN_CHIME.notes.length + CLOSE_CHIME.notes.length);

    const suspended = stubContext('suspended');
    (suspended.context as unknown as { resume(): Promise<void> }).resume = () => new Promise(() => undefined);
    const stuck = createChimes({ context: () => suspended.context, readyWaitMs: 20 });
    expect(await stuck.ready()).toBe(false);
    stuck.open(); // a context that is not running plays nothing, and does not throw
    await settle();
    expect(suspended.notes).toEqual([]);
  });

  it('with no AudioContext at all, ready() is true (the wake will say not-supported) and the chimes are silent', async () => {
    const chimes = createChimes({ context: () => undefined });
    expect(await chimes.ready()).toBe(true);
    expect(() => chimes.open()).not.toThrow();
  });
});
