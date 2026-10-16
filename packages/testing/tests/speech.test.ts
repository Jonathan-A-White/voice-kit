import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installSpeech, speechInitScript } from '../src/speech.js';
import type { SpeechFake } from '../src/speech.js';

let fake: SpeechFake;
let target: Record<string, unknown>;

beforeEach(() => {
  vi.useFakeTimers();
  target = {};
  fake = installSpeech(target);
});
afterEach(() => {
  fake.uninstall();
  vi.useRealTimers();
});

/** An utterance that writes its events, with the time they came, into `events`. */
function speak(text: string, events: string[], rate = 1) {
  const u = new fake.Utterance(text);
  u.rate = rate;
  const t0 = Date.now();
  const mark = (name: string) => events.push(`${name}@${Date.now() - t0}`);
  u.onstart = () => mark('start');
  u.onboundary = (e) => mark(`boundary:${e.charIndex}`);
  u.onend = () => mark('end');
  u.onerror = (e) => mark(`error:${e.error}`);
  u.onpause = () => mark('pause');
  u.onresume = () => mark('resume');
  fake.synth.speak(u);
  return u;
}

describe('installing', () => {
  it('puts speechSynthesis and SpeechSynthesisUtterance on the target', () => {
    expect(target.speechSynthesis).toBe(fake.synth);
    expect(target.SpeechSynthesisUtterance).toBe(fake.Utterance);
  });

  it('uninstall takes them off again', () => {
    fake.uninstall();
    expect('speechSynthesis' in target).toBe(false);
    expect('SpeechSynthesisUtterance' in target).toBe(false);
    fake = installSpeech(target);
  });
});

describe('an utterance in time', () => {
  it('fires start, a boundary for each word with its charIndex, then end, in order', async () => {
    const events: string[] = [];
    speak('Hello there world', events);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(events.map((e) => e.split('@')[0])).toEqual(['start', 'boundary:0', 'boundary:6', 'boundary:12', 'end']);
  });

  it('takes 150 ms and 60 ms a word: three words end at 330 ms, and not before', async () => {
    const events: string[] = [];
    speak('Hello there world', events);
    await vi.advanceTimersByTimeAsync(329);
    expect(events).not.toContain('end@330');
    expect(events.some((e) => e.startsWith('end'))).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(events[events.length - 1]).toBe('end@330');
  });

  it('is scaled by rate: at rate 2 the same text ends at 165 ms', async () => {
    const events: string[] = [];
    speak('Hello there world', events, 2);
    await vi.advanceTimersByTimeAsync(165);
    expect(events[events.length - 1]).toBe('end@165');
  });

  it('takes a time set by its text, so a longer text takes longer', async () => {
    const short: string[] = [];
    const long: string[] = [];
    speak('One', short);
    await vi.advanceTimersByTimeAsync(10_000);
    speak('A great many more words than the first one has', long);
    await vi.advanceTimersByTimeAsync(10_000);
    const endOf = (events: string[]) => Number(events.find((e) => e.startsWith('end'))?.split('@')[1]);
    expect(endOf(short)).toBe(210);
    expect(endOf(long)).toBe(150 + 10 * 60);
  });

  it('speak is not synchronous: nothing fires until time moves', () => {
    const events: string[] = [];
    speak('Hello', events);
    expect(events).toEqual([]);
  });

  it('options set the pace', async () => {
    fake.uninstall();
    fake = installSpeech(target, { msPerWord: 100, baseMs: 0 });
    const events: string[] = [];
    speak('a b c', events);
    await vi.advanceTimersByTimeAsync(300);
    expect(events[events.length - 1]).toBe('end@300');
  });
});

describe('speaking, pending and paused', () => {
  it('speaking is true from speak() to the end; pending is true while a second one waits', async () => {
    expect(fake.synth.speaking).toBe(false);
    expect(fake.synth.pending).toBe(false);
    const events: string[] = [];
    speak('one', events);
    expect(fake.synth.speaking).toBe(true);
    expect(fake.synth.pending).toBe(false);
    speak('two', events);
    expect(fake.synth.pending).toBe(true);
    await vi.advanceTimersByTimeAsync(210); // first ends, second starts
    expect(fake.synth.speaking).toBe(true);
    expect(fake.synth.pending).toBe(false);
    await vi.advanceTimersByTimeAsync(210);
    expect(fake.synth.speaking).toBe(false);
  });

  it('speaking is already false inside onend, so the next speak() runs', async () => {
    const seen: boolean[] = [];
    const u = new fake.Utterance('one');
    u.onend = () => seen.push(fake.synth.speaking);
    fake.synth.speak(u);
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toEqual([false]);
  });

  it('the queue runs in order, each after the one before has ended', async () => {
    const events: string[] = [];
    const a = speak('one', events);
    const b = speak('two', events);
    expect(a).not.toBe(b);
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toEqual(['start@0', 'boundary:0@150', 'end@210', 'start@210', 'boundary:0@360', 'end@420']);
    expect(fake.spoken()).toEqual(['one', 'two']);
  });

  it('refuses something that is not an utterance', () => {
    expect(() => fake.synth.speak({ text: 'hi' } as never)).toThrow(TypeError);
  });
});

describe('pause, resume and cancel', () => {
  it('pause holds the current utterance and resume continues it where it was', async () => {
    const events: string[] = [];
    speak('Hello there world', events);
    await vi.advanceTimersByTimeAsync(200); // start, boundary 0 at 150
    fake.synth.pause();
    expect(fake.synth.paused).toBe(true);
    expect(fake.synth.speaking).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events.some((e) => e.startsWith('end'))).toBe(false);
    expect(events.filter((e) => e.startsWith('pause'))).toHaveLength(1);
    fake.synth.resume();
    expect(fake.synth.paused).toBe(false);
    const resumedAt = Date.now();
    await vi.advanceTimersByTimeAsync(129);
    expect(events.some((e) => e.startsWith('end'))).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(Date.now() - resumedAt).toBe(130); // 330 in all, 200 already spoken
    expect(events.some((e) => e.startsWith('end'))).toBe(true);
    expect(events.map((e) => e.split('@')[0])).toEqual(['start', 'boundary:0', 'pause', 'resume', 'boundary:6', 'boundary:12', 'end']);
  });

  it('an utterance spoken while paused waits for resume', async () => {
    fake.synth.pause();
    const events: string[] = [];
    speak('one', events);
    await vi.advanceTimersByTimeAsync(5000);
    expect(events).toEqual([]);
    fake.synth.resume();
    await vi.advanceTimersByTimeAsync(210);
    expect(events[events.length - 1]).toBe('end@5210'); // 5000 waiting, 210 speaking
  });

  it("cancel ends the current utterance with error 'interrupted' and drops the queue with 'canceled'", async () => {
    const events: string[] = [];
    speak('Hello there world', events);
    speak('second', events);
    speak('third', events);
    await vi.advanceTimersByTimeAsync(100);
    fake.synth.cancel();
    expect(fake.synth.speaking).toBe(false);
    expect(fake.synth.pending).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(events.filter((e) => e.startsWith('error'))).toEqual(['error:interrupted@100', 'error:canceled@100', 'error:canceled@100']);
    expect(events.some((e) => e.startsWith('end'))).toBe(false);
    expect(fake.spoken()).toEqual(['Hello there world']);
  });

  it('cancel with nothing to say does nothing', () => {
    expect(() => fake.synth.cancel()).not.toThrow();
  });

  it('after a cancel the next speak() runs', async () => {
    const events: string[] = [];
    speak('one', events);
    fake.synth.cancel();
    const again: string[] = [];
    speak('two', again);
    await vi.advanceTimersByTimeAsync(1000);
    expect(again[again.length - 1]).toBe('end@210');
  });
});

describe('voices', () => {
  it('getVoices is empty until voiceschanged fires 50 ms after install', async () => {
    const changed: number[] = [];
    fake.synth.onvoiceschanged = () => changed.push(fake.synth.getVoices().length);
    expect(fake.synth.getVoices()).toEqual([]);
    await vi.advanceTimersByTimeAsync(49);
    expect(fake.synth.getVoices()).toEqual([]);
    expect(changed).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toBeGreaterThan(0);
    expect(fake.synth.getVoices().map((v) => v.lang)).toContain('el-GR');
  });

  it('addEventListener hears voiceschanged too', async () => {
    let heard = 0;
    fake.synth.addEventListener('voiceschanged', () => heard++);
    await vi.advanceTimersByTimeAsync(50);
    expect(heard).toBe(1);
  });

  it('the voices are the options', async () => {
    fake.uninstall();
    fake = installSpeech(target, { voices: [{ voiceURI: 'x', name: 'X', lang: 'fr-FR', localService: true, default: true }] });
    await vi.advanceTimersByTimeAsync(50);
    expect(fake.synth.getVoices().map((v) => v.name)).toEqual(['X']);
  });
});

describe('voices are as stable as a phone gives them', () => {
  it('getVoices returns the same array and the same voice objects on every call until voiceschanged', async () => {
    const before = fake.synth.getVoices();
    expect(fake.synth.getVoices()).toBe(before);
    await vi.advanceTimersByTimeAsync(50);
    const after = fake.synth.getVoices();
    expect(after).not.toBe(before);
    expect(after.length).toBeGreaterThan(0);
    const again = fake.synth.getVoices();
    expect(again).toBe(after);
    again.forEach((v, i) => expect(v).toBe(after[i]));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fake.synth.getVoices()).toBe(after);
  });
});

describe('the log', () => {
  it('says what was spoken, when it was queued, started and ended, and how it went', async () => {
    await vi.advanceTimersByTimeAsync(1000);
    const events: string[] = [];
    speak('one', events);
    await vi.advanceTimersByTimeAsync(300);
    speak('two', events);
    await vi.advanceTimersByTimeAsync(50);
    fake.synth.cancel();
    expect(fake.log.map(({ text, queuedAt, startedAt, endedAt, outcome }) => ({ text, queuedAt, startedAt, endedAt, outcome }))).toEqual([
      { text: 'one', queuedAt: 1000, startedAt: 1000, endedAt: 1210, outcome: 'ended' },
      { text: 'two', queuedAt: 1300, startedAt: 1300, endedAt: 1350, outcome: 'interrupted' },
    ]);
  });
});

describe('the init script for Playwright', () => {
  it('installs the same fake on a page, from a string', async () => {
    fake.uninstall();
    const g = globalThis as Record<string, unknown>;
    (0, eval)(speechInitScript({ msPerWord: 10, baseMs: 0 }));
    const synth = g.speechSynthesis as typeof fake.synth;
    const Utterance = g.SpeechSynthesisUtterance as typeof fake.Utterance;
    let ended = 0;
    const u = new Utterance('a b');
    u.onend = () => ended++;
    synth.speak(u);
    await vi.advanceTimersByTimeAsync(20);
    expect(ended).toBe(1);
    (g.__bsvKitTesting as { speech: SpeechFake }).speech.uninstall();
    expect('speechSynthesis' in g).toBe(false);
    fake = installSpeech(target);
  });
});
