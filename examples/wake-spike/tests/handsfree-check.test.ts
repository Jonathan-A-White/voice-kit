// The Hands-free check panel's logic (mw-rl10piw.4), with no browser: the kit's own fake wake (voice-kit/testing/handsfree) and
// the mic fake's recogniser behind composer's startListening, on fake time. A wake runs the REAL session from voice-kit/handsfree;
// the check logs one entry per exchange: the way, the ms from the wake to the recogniser open, the words or the error's kind,
// whether the detector's track ended or went mute meanwhile, and whether the wake was heard again afterwards.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startListening } from 'voice-kit/composer';
import { browserWake } from 'voice-kit/handsfree';
import type { MicWay, WakePort, WakeRunning } from 'voice-kit/handsfree';
import { installWake } from 'voice-kit/testing/handsfree';
import type { WakeFake } from 'voice-kit/testing/handsfree';
import { installMic } from 'voice-kit/testing/mic';
import type { Clip, MicFake } from 'voice-kit/testing/mic';
import { createHandsFreeCheck } from '../src/handsfreeCheck.js';
import type { HandsFreeCheck } from '../src/handsfreeCheck.js';
import { createLog } from '../src/log.js';
import type { Log } from '../src/log.js';

/** A clip the recogniser hears as `transcript`, lasting `ms`. */
function clipOf(transcript: string, ms: number): Clip {
  const bytes = Math.round((ms / 1000) * 16000) * 2;
  const wav = Buffer.alloc(44 + bytes);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + bytes, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(bytes, 40);
  return { name: transcript, lang: 'en-US', transcript, wavBase64: wav.toString('base64') };
}

const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

let mic: MicFake;
let wake: WakeFake;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  vi.stubGlobal('window', globalThis);
  mic = installMic(globalThis, { clip: clipOf('play john three', 1200) });
  wake = installWake(globalThis);
});
afterEach(() => {
  wake.uninstall();
  mic.uninstall();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** An audio element's three calls, as the page's player has them. */
function fakeAudio(playing: boolean) {
  const state = { playing };
  const calls: string[] = [];
  return {
    calls,
    state,
    port: {
      isPlaying: () => state.playing,
      pause: () => {
        calls.push('pause');
        state.playing = false;
      },
      play: () => {
        calls.push('play');
        state.playing = true;
      },
    },
  };
}

interface Rig {
  check: HandsFreeCheck;
  log: Log;
  audio: ReturnType<typeof fakeAudio>;
  checkEntries(): { event: string; detail?: Record<string, unknown> }[];
}

function setup(way: MicWay, options: { playing?: boolean; pauseMs?: number; wakePort?: WakePort } = {}): Rig {
  const log = createLog(undefined);
  const audio = fakeAudio(options.playing ?? true);
  const check = createHandsFreeCheck({
    wake: options.wakePort ?? browserWake({ modelUrl: '/models/hey-lampas.json' }),
    listen: startListening,
    audio: audio.port,
    log,
    way: () => way,
    pauseMs: () => options.pauseMs ?? 1500,
  });
  return { check, log, audio, checkEntries: () => log.entries().filter((entry) => entry.event === 'hands-free-check') };
}

async function started(rig: Rig): Promise<void> {
  void rig.check.start();
  await advance(200);
  expect(rig.check.state().name).toBe('waiting');
}

describe.each<MicWay>(['handover', 'share'])('the Hands-free check, way %s', (way) => {
  it('a wake, "play john three" and the pause log one entry with the way, the ms to open, the words and "wake heard again: yes"', async () => {
    const rig = setup(way);
    await started(rig);
    expect(wake.say()).toBe(true);
    await advance(8000);

    const [entry, ...rest] = rig.checkEntries();
    expect(rest).toEqual([]);
    expect(entry.detail).toMatchObject({ way, words: 'play john three', error: null, trackEnded: false, trackMuted: false });
    // the fake recogniser opens 300 ms after it is started; the wake's own start adds nothing in 'share'
    expect(entry.detail?.openMs).toBeGreaterThanOrEqual(300);
    expect(entry.detail?.openMs).toBeLessThan(1000);
    expect(entry.detail?.wakeAgain).toBe('not yet');
    expect(rig.check.view().last).toContain('play john three');
    expect(rig.check.view().last).toContain('wake heard again: not yet');
    expect(rig.check.state().name).toBe('waiting');

    // a second say() is the wake heard again: the same entry now says yes
    expect(wake.say()).toBe(true);
    await advance(10);
    expect(rig.checkEntries()).toHaveLength(1);
    expect(rig.checkEntries()[0].detail?.wakeAgain).toBe('yes');
    expect(rig.check.view().last).toContain('wake heard again: yes');
    expect(rig.check.view().last).toContain(way);
    await advance(8000);
    rig.check.stop();
  });

  it('a recogniser error logs its kind and the session is waiting again', async () => {
    mic.options.denied = true; // the recogniser errors 'not-allowed': kind permission-denied, which fails a bare session
    const rig = setup(way);
    await started(rig);
    wake.say();
    await advance(2000);
    expect(rig.checkEntries()).toHaveLength(1);
    const [entry] = rig.checkEntries();
    expect(entry.detail).toMatchObject({ way, words: null, error: 'permission-denied', closed: 'listen-error', wakeAgain: 'not yet' });
    expect(rig.check.view().last).toContain('permission-denied');
    // a bare session would now be failed; the check starts it again, so the wake listens and is heard again
    expect(rig.check.state().name).toBe('waiting');
    expect(wake.listening).toBe(true);
    expect(wake.say()).toBe(true);
    await advance(10);
    expect(rig.checkEntries()[0].detail?.wakeAgain).toBe('yes');
    await advance(2000);
    rig.check.stop();
    await advance(10);
    expect(wake.listening).toBe(false);
  });

  it("pauses the audio at the open and plays it at the close when it was playing", async () => {
    const rig = setup(way, { playing: true });
    await started(rig);
    wake.say();
    await advance(8000);
    expect(rig.audio.calls).toEqual(['pause', 'play']);
    rig.check.stop();
  });

  it('does not play the audio at the close when it was not playing', async () => {
    const rig = setup(way, { playing: false });
    await started(rig);
    wake.say();
    await advance(8000);
    expect(rig.checkEntries()).toHaveLength(1);
    expect(rig.audio.calls).toEqual([]);
    rig.check.stop();
  });

  it('plays the audio at the close after an error too', async () => {
    mic.options.denied = true;
    const rig = setup(way, { playing: true });
    await started(rig);
    wake.say();
    await advance(2000);
    expect(rig.audio.calls).toEqual(['pause', 'play']);
    rig.check.stop();
  });

  it('reads the pause length at each command: a pause of 3 s ends the words 3 s after the last of them', async () => {
    const rig = setup(way, { pauseMs: 3000 });
    await started(rig);
    wake.say();
    await advance(1000 + 300 + 1200 + 1500); // open, the clip, a 1.5 s pause: not yet
    expect(rig.checkEntries()).toHaveLength(0);
    await advance(3000);
    expect(rig.checkEntries()).toHaveLength(1);
    expect(rig.checkEntries()[0].detail).toMatchObject({ words: 'play john three', pauseMs: 3000 });
    rig.check.stop();
  });
});

describe('the detector track', () => {
  /** A wake port of its own whose track the test can end or mute. */
  function trackedWake(): { port: WakePort; track: EventTarget & { stop(): void }; say(): void; started: number } {
    const track = Object.assign(new EventTarget(), { stop: () => undefined });
    const state = { started: 0, onWake: undefined as undefined | (() => void) };
    const port: WakePort = {
      async start(onWake) {
        state.started++;
        state.onWake = onWake;
        const running: WakeRunning = { ok: true, track: track as unknown as MediaStreamTrack, stop: () => undefined };
        return running;
      },
    };
    return {
      port,
      track,
      say: () => state.onWake?.(),
      get started() {
        return state.started;
      },
    };
  }

  it("says in the entry that the detector's track ended while the exchange was open", async () => {
    const tracked = trackedWake();
    const rig = setup('share', { wakePort: tracked.port });
    await started(rig);
    tracked.say();
    await advance(500);
    tracked.track.dispatchEvent(new Event('ended'));
    await advance(8000);
    expect(rig.checkEntries()[0].detail).toMatchObject({ trackEnded: true, trackMuted: false });
    expect(rig.check.view().last).toContain('ended');
    rig.check.stop();
  });

  it("says in the entry that the detector's track went mute, and not for a mute outside an exchange", async () => {
    const tracked = trackedWake();
    const rig = setup('share', { wakePort: tracked.port });
    await started(rig);
    tracked.track.dispatchEvent(new Event('mute')); // before any wake: not this exchange's
    tracked.say();
    await advance(500);
    tracked.track.dispatchEvent(new Event('mute'));
    await advance(8000);
    expect(rig.checkEntries()[0].detail).toMatchObject({ trackEnded: false, trackMuted: true });
    rig.check.stop();
  });

  it('a second exchange logs a second entry and the first one says the wake was heard again', async () => {
    const rig = setup('handover');
    await started(rig);
    wake.say();
    await advance(8000);
    wake.say();
    await advance(8000);
    const entries = rig.checkEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].detail?.wakeAgain).toBe('yes');
    expect(entries[1].detail?.wakeAgain).toBe('not yet');
    rig.check.stop();
  });
});

describe('the log an entry is updated in', () => {
  it('update adds to an entry in place, keeps its time and place, and saves it', () => {
    const saved: Record<string, string> = {};
    const log = createLog({ getItem: (key) => saved[key] ?? null, setItem: (key, value) => void (saved[key] = value), removeItem: (key) => void delete saved[key] });
    log.add('before');
    const entry = log.add('hands-free-check', { way: 'share', wakeAgain: 'not yet' });
    log.add('after');
    const updated = log.update(entry, { wakeAgain: 'yes' });
    expect(log.entries().map((each) => each.event)).toEqual(['before', 'hands-free-check', 'after']);
    expect(log.entries()[1]).toBe(updated);
    expect(updated).toMatchObject({ time: entry.time, detail: { way: 'share', wakeAgain: 'yes' } });
    expect(JSON.parse(saved['wake-spike-log'])[1].detail.wakeAgain).toBe('yes');
  });
});
