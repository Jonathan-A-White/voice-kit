// @voice-kit/handsfree (mw-rl10piw.2): the hands-free session on fake time. The wake is the kit's own startWake with the
// testing wake fake installed (voice-kit/testing/handsfree), the listen port is composer's startListening over the mic fake's
// honest recogniser (voice-kit/testing/mic): no network, no browser, the same code an app runs.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startListening } from 'voice-kit/composer';
import { browserWake, createChimes, createHandsFree } from 'voice-kit/handsfree';
import type { CloseReason, CommandDone, HandsFree, HandsFreeOptions, HandsFreePorts, HandsFreeState, VisibilityPort, WakePort } from 'voice-kit/handsfree';
import { installMic, type Clip, type FakeRecognition, type FakeTrack, type MicFake } from 'voice-kit/testing/mic';
import { installWake, type WakeFake } from 'voice-kit/testing/handsfree';

/** A clip the recogniser hears as `transcript`, lasting `ms` (the fake spreads the words over its length by their lengths). */
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

const READ_JOHN = clipOf('read john three', 1200);
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);

interface Deferred {
  promise: Promise<CommandDone | void>;
  resolve(done?: CommandDone): void;
  reject(err: unknown): void;
}
const deferred = (): Deferred => {
  let resolve!: (done?: CommandDone) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<CommandDone | void>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
};

interface Harness {
  hf: HandsFree;
  wake: WakeFake;
  mic: MicFake;
  /** What happened, in order: hooks, chimes, states, and each recogniser start with what it listened on. */
  log: string[];
  commands: [string, { followUp: boolean }][];
  closes: CloseReason[];
  /** The kind each onClose carried (undefined: none). */
  closeKinds: (string | undefined)[];
  states: HandsFreeState[];
  chime: { open: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
  /** Recogniser starts (fake time of each 'start' event, i.e. the microphone open). */
  opens: number[];
  /** Recognisers started and not yet ended. */
  running(): number;
  /** The tracks each recogniser was started on. */
  startedOn: (FakeTrack | undefined)[];
  visibility: { hidden: boolean; set(hidden: boolean): void } & VisibilityPort;
  onCommand: ReturnType<typeof vi.fn>;
  onInterrupt: ReturnType<typeof vi.fn>;
}

let mic: MicFake;
let wake: WakeFake;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  vi.stubGlobal('window', globalThis);
  mic = installMic(globalThis, { clip: READ_JOHN });
  wake = installWake(globalThis);
});

afterEach(() => {
  wake.uninstall();
  mic.uninstall();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

type Answer = CommandDone | void | Deferred | (() => never);

function setup(options: Omit<HandsFreeOptions, 'mic'> & { mic?: 'handover' | 'share'; answers?: Answer[]; interrupt?: boolean; wakePort?: WakePort } = {}): Harness {
  const log: string[] = [];
  const commands: [string, { followUp: boolean }][] = [];
  const closes: CloseReason[] = [];
  const closeKinds: (string | undefined)[] = [];
  const states: HandsFreeState[] = [];
  const opens: number[] = [];
  const live = new Set<FakeRecognition>();
  const startedOn: (FakeTrack | undefined)[] = [];
  const firstWakeTrack = () => wake.tracks[0];
  const proto = mic.SpeechRecognition.prototype as FakeRecognition;
  const realStart = proto.start;
  proto.start = function (this: FakeRecognition, track?: FakeTrack) {
    realStart.call(this, track);
    live.add(this);
    startedOn.push(track);
    const wakeTrack = firstWakeTrack();
    log.push(`recogniser:start on ${track ? (track === wakeTrack ? 'the wake track' : 'a clone') : 'the default microphone'}, wake track ${wakeTrack?.readyState ?? 'none'}`);
    const onStart = () => {
      opens.push(Date.now());
      this.removeEventListener('start', onStart as never);
    };
    this.addEventListener('start', onStart as never);
    const onEnd = () => {
      live.delete(this);
      this.removeEventListener('end', onEnd as never);
    };
    this.addEventListener('end', onEnd as never);
  };
  const answers = [...(options.answers ?? [])];
  const onCommand = vi.fn((words: string, info: { followUp: boolean }) => {
    commands.push([words, info]);
    log.push(`onCommand:${words}:${info.followUp}`);
    const answer = answers.shift();
    if (typeof answer === 'function') return answer();
    if (answer && 'promise' in answer) return answer.promise;
    return Promise.resolve(answer);
  });
  const onInterrupt = vi.fn(() => {
    log.push('onInterrupt');
    return options.interrupt ?? true;
  });
  const chime = {
    open: vi.fn(() => log.push('chime:open')),
    close: vi.fn(() => log.push('chime:close')),
  };
  const listeners = new Set<() => void>();
  const visibility = {
    hidden: false,
    set(hidden: boolean) {
      visibility.hidden = hidden;
      for (const l of [...listeners]) l();
    },
    isHidden: () => visibility.hidden,
    onChange(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const ports: HandsFreePorts = {
    wake: options.wakePort ?? browserWake({ modelUrl: '/models/hey-lampas.json' }),
    listen: startListening,
    chime,
    visibility,
    onOpen: () => void log.push('onOpen'),
    onCommand,
    onInterrupt,
    onClose: ({ reason, kind }) => {
      closes.push(reason);
      closeKinds.push(kind);
      log.push(`onClose:${reason}`);
    },
    onState: (state) => {
      states.push(state);
      log.push(`state:${state.name}${state.name === 'failed' ? ':' + state.kind : ''}`);
    },
  };
  const hf = createHandsFree(ports, options);
  return {
    hf,
    wake,
    mic,
    log,
    commands,
    closes,
    closeKinds,
    states,
    chime,
    opens,
    running: () => live.size,
    startedOn,
    visibility,
    onCommand,
    onInterrupt,
  };
}

/** Starts the session and lets the wake open. */
async function started(h: Harness) {
  void h.hf.start();
  await advance(200);
  expect(h.hf.state().name).toBe('waiting');
}

/** Says the wake word and moves time to the moment the recogniser opens (the fake takes 300 ms). */
async function woken(h: Harness) {
  expect(h.wake.say()).toBe(true);
  await advance(300);
}

/** Moves time until the n-th recogniser has opened (n counted from 1), and returns its open time. */
async function untilOpen(h: Harness, n: number): Promise<number> {
  for (let i = 0; i < 10000 && h.opens.length < n; i++) await advance(1);
  expect(h.opens.length).toBeGreaterThanOrEqual(n);
  return h.opens[n - 1];
}

/** Moves time until `at` (fake ms). */
const until = (at: number) => advance(at - Date.now());

const names = (h: Harness) => h.states.map((s) => s.name);

describe('the wake (criterion 1)', () => {
  it('calls onOpen once, then opens the microphone, then sounds the open chime only after the recogniser reports started; waiting then listening', async () => {
    const h = setup();
    await started(h);
    h.wake.say();
    await advance(299);
    expect(h.log.filter((e) => !e.startsWith('state:'))).toEqual(['onOpen', 'recogniser:start on the default microphone, wake track ended']);
    expect(h.chime.open).not.toHaveBeenCalled();
    expect(h.hf.state().name).toBe('waiting');
    await advance(1);
    expect(h.log).toEqual([
      'state:starting',
      'state:waiting',
      'onOpen',
      'recogniser:start on the default microphone, wake track ended',
      'chime:open',
      'state:listening',
    ]);
    h.hf.stop();
  });

  it("in 'handover' the wake's track is ended before the recogniser starts", async () => {
    const h = setup({ mic: 'handover' });
    await started(h);
    const track = h.wake.tracks[0];
    expect(track.readyState).toBe('live');
    await woken(h);
    expect(h.startedOn).toEqual([undefined]);
    expect(h.log).toContain('recogniser:start on the default microphone, wake track ended');
    expect(h.wake.listening).toBe(false);
    h.hf.stop();
  });

  it("in 'share' the recogniser's openInput gives a clone of the wake's track and the wake is not stopped; its wakes are ignored while listening", async () => {
    const h = setup({ mic: 'share' });
    await started(h);
    const track = h.wake.tracks[0];
    await woken(h);
    expect(h.startedOn).toHaveLength(1);
    const listenedOn = h.startedOn[0];
    expect(listenedOn).toBeDefined();
    expect(listenedOn).not.toBe(track);
    expect(h.wake.tracks).toContain(listenedOn);
    expect(listenedOn?.readyState).toBe('live');
    expect(track.readyState).toBe('live');
    expect(h.wake.listening).toBe(true);
    expect(h.chime.open).toHaveBeenCalledTimes(1);
    expect(h.hf.state().name).toBe('listening');
    expect(h.wake.say()).toBe(true);
    await advance(400);
    expect(h.log.filter((e) => e === 'onOpen')).toHaveLength(1);
    expect(h.startedOn).toHaveLength(1);
    h.hf.stop();
  });
});

describe('the end of a command (criterion 2)', () => {
  it("takes 'read john three' after 1500 ms of no change, once", async () => {
    const h = setup();
    await started(h);
    await woken(h);
    const open = Date.now();
    await until(open + 1200 + 1499);
    expect(h.commands).toEqual([]);
    await advance(200);
    expect(h.commands).toEqual([['read john three', { followUp: false }]]);
    await advance(10000);
    expect(h.onCommand).toHaveBeenCalledTimes(1);
  });

  it('with pauseMs 3000, words, 2000 ms, more words, 3000 ms: ONE onCommand with all the words', async () => {
    mic.options.clip = clipOf('read john three', 6000); // 'read' at 1875 ms, 'read john' at 3750, all three at 6000
    const h = setup({ pauseMs: 3000 });
    await started(h);
    await woken(h);
    const open = Date.now();
    await until(open + 6000 + 2999);
    expect(h.commands).toEqual([]);
    await advance(200);
    expect(h.commands).toEqual([['read john three', { followUp: false }]]);
    await advance(20000);
    expect(h.onCommand).toHaveBeenCalledTimes(1);
  });

  it('reads pauseMs given as a function at each command', async () => {
    const pauseMs = vi.fn().mockReturnValueOnce(1500).mockReturnValueOnce(3000);
    const h = setup({ pauseMs, answers: [{ followUp: true }, { followUp: false }] });
    await started(h);
    await woken(h);
    expect(pauseMs).toHaveBeenCalledTimes(1);
    await advance(1200 + 1500 + 200);
    expect(h.commands).toHaveLength(1);
    const open = await untilOpen(h, 2);
    expect(pauseMs).toHaveBeenCalledTimes(2);
    await until(open + 1200 + 2999);
    expect(h.commands).toHaveLength(1);
    await advance(200);
    expect(h.commands).toEqual([
      ['read john three', { followUp: false }],
      ['read john three', { followUp: true }],
    ]);
  });
});

describe('no speech and a long command (criterion 3)', () => {
  it('no words for 6000 ms after the chime: the close chime, onClose, the state waiting, the wake running again', async () => {
    mic.options.silent = Infinity;
    const h = setup();
    await started(h);
    await woken(h);
    expect(h.chime.open).toHaveBeenCalledTimes(1);
    await advance(5999);
    expect(h.chime.close).not.toHaveBeenCalled();
    expect(h.closes).toEqual([]);
    await advance(1);
    expect(h.chime.close).toHaveBeenCalledTimes(1);
    expect(h.closes).toEqual(['no-speech']);
    await advance(200);
    expect(h.hf.state().name).toBe('waiting');
    expect(h.wake.listening).toBe(true);
    expect(h.running()).toBe(0);
    expect(h.commands).toEqual([]);
  });

  it('a recogniser that ends no-speech sooner than the session waits: the close says its kind (mw-rl10piw.16)', async () => {
    mic.options.silent = Infinity;
    mic.options.noSpeechMs = 2000; // below the session's 6000: composer starts it again each time, unheard
    const h = setup();
    await started(h);
    await woken(h);
    await advance(6000);
    expect(h.closes).toEqual(['no-speech']);
    expect(h.closeKinds).toEqual(['no-speech']);
  });

  it('a close with no recogniser error carries no kind', async () => {
    mic.options.silent = Infinity;
    const h = setup();
    await started(h);
    await woken(h);
    await advance(6000);
    expect(h.closes).toEqual(['no-speech']);
    expect(h.closeKinds).toEqual([undefined]);
  });

  it('a command still gaining words at 60000 ms is taken as ended there', async () => {
    const words = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
    mic.options.clip = clipOf(words, 70000); // a word about every 700 ms, past 60 s
    const h = setup();
    await started(h);
    await woken(h);
    const open = Date.now();
    await until(open + 59999);
    expect(h.commands).toEqual([]);
    await advance(200);
    expect(h.commands).toHaveLength(1);
    const [taken] = h.commands[0];
    expect(taken.startsWith('word0 word1 word2')).toBe(true);
    expect(taken.split(' ').length).toBeGreaterThan(80);
    expect(taken.split(' ').length).toBeLessThan(100);
  });
});

describe('the follow-up (criterion 4)', () => {
  it('opens the microphone again with no open chime; words at 5000 ms go to onCommand with followUp true', async () => {
    const h = setup({ answers: [{ followUp: true }, { followUp: false }] });
    await started(h);
    await woken(h);
    await advance(1200 + 1500 + 200);
    expect(h.commands).toHaveLength(1);
    mic.options.silent = 5000; // he speaks again 5 s into the window
    const open = await untilOpen(h, 2);
    expect(h.hf.state().name).toBe('follow-up');
    expect(h.chime.open).toHaveBeenCalledTimes(1);
    await until(open + 5000 + 1200 + 1500 + 200);
    expect(h.commands).toEqual([
      ['read john three', { followUp: false }],
      ['read john three', { followUp: true }],
    ]);
    expect(h.chime.open).toHaveBeenCalledTimes(1);
    expect(h.closes).toEqual(['done']);
    expect(h.chime.close).not.toHaveBeenCalled();
  });

  it('no words: the close chime at 8000 ms and onClose once', async () => {
    const h = setup({ answers: [{ followUp: true }] });
    await started(h);
    await woken(h);
    await advance(1200 + 1500 + 200);
    mic.options.silent = Infinity;
    const open = await untilOpen(h, 2);
    expect(names(h)).toContain('follow-up');
    await until(open + 7999);
    expect(h.chime.close).not.toHaveBeenCalled();
    expect(h.closes).toEqual([]);
    await advance(1);
    expect(h.chime.close).toHaveBeenCalledTimes(1);
    expect(h.closes).toEqual(['follow-up-ended']);
    await advance(20000);
    expect(h.closes).toHaveLength(1);
    expect(h.onCommand).toHaveBeenCalledTimes(1);
    expect(h.hf.state().name).toBe('waiting');
  });
});

describe('onOpen and onClose pair exactly once (criterion 5)', () => {
  const paths: [string, (h: Harness) => Promise<void>, Omit<Parameters<typeof setup>[0], never>?][] = [
    ['a command', async () => void (await advance(5000))],
    [
      'no speech',
      async () => {
        mic.options.silent = Infinity;
        await advance(10000);
      },
    ],
    [
      'a recogniser error',
      async () => {
        mic.options.denied = true;
        await advance(10000);
      },
    ],
    [
      'a recogniser that never opens',
      async () => {
        mic.options.openMs = 60000;
        await advance(10000);
      },
    ],
    [
      'stop() while listening',
      async (h) => {
        await advance(400);
        expect(h.hf.state().name).toBe('listening');
        h.hf.stop();
        await advance(1000);
      },
    ],
    [
      'the page hidden while listening',
      async (h) => {
        await advance(400);
        expect(h.hf.state().name).toBe('listening');
        h.visibility.set(true);
        await advance(1000);
      },
    ],
    ['onCommand throwing', async () => void (await advance(5000)), { answers: [() => { throw new Error('the app failed'); }] }],
    [
      'a follow-up that times out',
      async () => {
        await advance(3000);
        mic.options.silent = Infinity;
        await advance(10000);
      },
      { answers: [{ followUp: true }] },
    ],
  ];

  for (const mode of ['handover', 'share'] as const) {
    for (const [name, run, extra] of paths) {
      it(`${mode}: ${name}`, async () => {
        const h = setup({ ...extra, mic: mode });
        await started(h);
        h.wake.say();
        await run(h);
        await advance(1000);
        expect(h.log.filter((e) => e === 'onOpen')).toHaveLength(1);
        expect(h.log.filter((e) => e.startsWith('onClose'))).toHaveLength(1);
        const firstStart = h.log.findIndex((e) => e.startsWith('recogniser:start'));
        expect(h.log.indexOf('onOpen')).toBeLessThan(firstStart === -1 ? Infinity : firstStart);
        expect(h.log.findIndex((e) => e.startsWith('onClose'))).toBeGreaterThan(h.log.indexOf('onOpen'));
        expect(h.running()).toBe(0);
        h.hf.stop();
        await advance(1000);
        expect(h.log.filter((e) => e.startsWith('onClose'))).toHaveLength(1);
      });
    }
  }

  it('says why each path closed', async () => {
    mic.options.openMs = 60000;
    const h = setup();
    await started(h);
    await woken(h);
    await advance(3000);
    expect(h.closes).toEqual(['no-open']);
    expect(h.chime.close).toHaveBeenCalledTimes(1);
    await advance(200);
    expect(h.hf.state().name).toBe('waiting');
  });

  it('a recogniser refused the microphone: failed permission-denied, the exchange closed', async () => {
    const h = setup();
    await started(h);
    mic.options.denied = true;
    await woken(h);
    await advance(1000);
    expect(h.closes).toEqual(['listen-error']);
    expect(h.hf.state()).toMatchObject({ name: 'failed', kind: 'permission-denied' });
    expect(h.wake.listening).toBe(false);
  });

  it('onCommand throwing closes with the close chime and goes back to waiting', async () => {
    const h = setup({ answers: [() => { throw new Error('the app failed'); }] });
    await started(h);
    await woken(h);
    await advance(3000);
    expect(h.closes).toEqual(['command-failed']);
    expect(h.chime.close).toHaveBeenCalledTimes(1);
    await advance(200);
    expect(h.hf.state().name).toBe('waiting');
  });
});

describe('a wake while a command is carried out (criterion 6)', () => {
  for (const mode of ['handover', 'share'] as const) {
    it(`${mode}: calls onInterrupt and opens a new command with no second onOpen`, async () => {
      const pending = deferred();
      const h = setup({ mic: mode, answers: [pending, { followUp: false }] });
      await started(h);
      await woken(h);
      await advance(1200 + 1500 + 200);
      expect(h.hf.state().name).toBe('working');
      await advance(200); // in 'handover' the wake opens again while the app works
      expect(h.wake.listening).toBe(true);
      expect(h.wake.say()).toBe(true);
      await advance(300);
      expect(h.onInterrupt).toHaveBeenCalledTimes(1);
      expect(h.log.filter((e) => e === 'onOpen')).toHaveLength(1);
      expect(h.startedOn).toHaveLength(2);
      expect(h.chime.open).toHaveBeenCalledTimes(2);
      expect(h.hf.state().name).toBe('listening');
      await advance(1200 + 1500 + 200);
      expect(h.commands).toEqual([
        ['read john three', { followUp: false }],
        ['read john three', { followUp: false }],
      ]);
      // the interrupted command answering late changes nothing
      pending.resolve({ followUp: true });
      await advance(1000);
      expect(h.startedOn).toHaveLength(2);
      expect(h.closes).toEqual(['done']);
      expect(h.log.filter((e) => e === 'onOpen')).toHaveLength(1);
    });

    it(`${mode}: when onInterrupt returns false no recogniser starts, no chime sounds and the pending command still resolves as it would have`, async () => {
      const pending = deferred();
      const h = setup({ mic: mode, interrupt: false, answers: [pending, { followUp: false }] });
      await started(h);
      await woken(h);
      await advance(1200 + 1500 + 200);
      await advance(200);
      expect(h.wake.say()).toBe(true);
      await advance(1000);
      expect(h.onInterrupt).toHaveBeenCalledTimes(1);
      expect(h.startedOn).toHaveLength(1);
      expect(h.chime.open).toHaveBeenCalledTimes(1);
      expect(h.chime.close).not.toHaveBeenCalled();
      expect(h.hf.state().name).toBe('working');
      pending.resolve({ followUp: true });
      const open = await untilOpen(h, 2);
      expect(h.hf.state().name).toBe('follow-up');
      expect(h.chime.open).toHaveBeenCalledTimes(1);
      await until(open + 1200 + 1500 + 200);
      expect(h.commands.map(([, info]) => info.followUp)).toEqual([false, true]);
      expect(h.closes).toEqual(['done']);
    });
  }
});

describe('nothing is left open (criterion 7)', () => {
  const into: [string, (h: Harness) => Promise<void>, Parameters<typeof setup>[0]?][] = [
    ['off', async () => undefined],
    [
      'starting',
      async (h) => {
        void h.hf.start();
        await advance(10);
        expect(h.hf.state().name).toBe('starting');
      },
    ],
    ['waiting', started],
    [
      'listening',
      async (h) => {
        await started(h);
        await woken(h);
        expect(h.hf.state().name).toBe('listening');
      },
    ],
    [
      'working',
      async (h) => {
        await started(h);
        await woken(h);
        await advance(1200 + 1500 + 300);
        expect(h.hf.state().name).toBe('working');
      },
      { answers: [deferred()] },
    ],
    [
      'follow-up',
      async (h) => {
        await started(h);
        await woken(h);
        await advance(1200 + 1500 + 200);
        mic.options.silent = Infinity;
        await untilOpen(h, 2);
        expect(h.hf.state().name).toBe('follow-up');
      },
      { answers: [{ followUp: true }] },
    ],
    [
      'failed',
      async (h) => {
        h.wake.failWith('permission-denied');
        void h.hf.start();
        await advance(200);
        expect(h.hf.state().name).toBe('failed');
      },
    ],
  ];

  for (const mode of ['handover', 'share'] as const) {
    for (const [name, into_, extra] of into) {
      it(`${mode}: after stop() from ${name}, no live microphone track and no running recogniser`, async () => {
        const h = setup({ ...extra, mic: mode });
        await into_(h);
        h.hf.stop();
        await advance(5000);
        expect(h.wake.liveTracks).toBe(0);
        expect(h.wake.listening).toBe(false);
        expect(h.running()).toBe(0);
        expect(h.hf.state().name).toBe('off');
        await advance(60000);
        expect(h.wake.liveTracks).toBe(0);
        expect(h.running()).toBe(0);
      });
    }

    it(`${mode}: the page hidden while listening leaves nothing open; visible again, the wake is started again`, async () => {
      const h = setup({ mic: mode });
      await started(h);
      await woken(h);
      h.visibility.set(true);
      await advance(5000);
      expect(h.wake.liveTracks).toBe(0);
      expect(h.running()).toBe(0);
      expect(h.hf.state()).toMatchObject({ name: 'off', hidden: true });
      const starts = h.wake.starts;
      h.visibility.set(false);
      await advance(200);
      expect(h.wake.starts).toBe(starts + 1);
      expect(h.wake.listening).toBe(true);
      expect(h.hf.state().name).toBe('waiting');
    });

    it(`${mode}: the page hidden while waiting stops the wake; a session that was stopped is not started by visibility`, async () => {
      const h = setup({ mic: mode });
      await started(h);
      h.visibility.set(true);
      await advance(100);
      expect(h.wake.liveTracks).toBe(0);
      h.visibility.set(false);
      await advance(200);
      expect(h.wake.listening).toBe(true);
      h.hf.stop();
      h.visibility.set(true);
      h.visibility.set(false);
      await advance(1000);
      expect(h.wake.listening).toBe(false);
      expect(h.wake.liveTracks).toBe(0);
    });
  }

  it('started while the page is hidden, it waits for the page to be visible', async () => {
    const h = setup();
    h.visibility.hidden = true;
    void h.hf.start();
    await advance(500);
    expect(h.wake.starts).toBe(0);
    expect(h.hf.state()).toMatchObject({ name: 'off', hidden: true });
    h.visibility.set(false);
    await advance(200);
    expect(h.hf.state().name).toBe('waiting');
  });
});

describe('failures (criterion 8)', () => {
  it("microphone refused: failed 'permission-denied' and start is not tried again by itself", async () => {
    const h = setup();
    h.wake.failWith('permission-denied');
    void h.hf.start();
    await advance(200);
    expect(h.hf.state()).toMatchObject({ name: 'failed', kind: 'permission-denied' });
    await advance(120000);
    h.visibility.set(true);
    h.visibility.set(false);
    await advance(1000);
    expect(h.wake.starts).toBe(1);
    expect(h.hf.state()).toMatchObject({ name: 'failed', kind: 'permission-denied' });
    // a start from him tries again
    h.wake.failWith();
    void h.hf.start();
    await advance(200);
    expect(h.wake.starts).toBe(2);
    expect(h.hf.state().name).toBe('waiting');
  });

  it("no AudioWorklet: failed 'not-supported'", async () => {
    wake.uninstall(); // the kit's own startWake, in Node: no AudioContext, no AudioWorkletNode
    const h = setup();
    await h.hf.start();
    expect(h.hf.state()).toMatchObject({ name: 'failed', kind: 'not-supported' });
    expect(h.log).toEqual(['state:starting', 'state:failed:not-supported']);
    wake = installWake(globalThis);
  });
});

describe('needs-touch (criterion 9)', () => {
  /** An AudioContext that, like Chrome's before a touch, stays suspended and whose resume() never settles until touched. */
  function stubAudio() {
    const audio = { touched: false };
    class StubContext {
      state: 'suspended' | 'running' = 'suspended';
      currentTime = 0;
      resume() {
        if (!audio.touched) return new Promise<void>(() => undefined);
        this.state = 'running';
        return Promise.resolve();
      }
    }
    return { audio, context: new StubContext() as unknown as AudioContext };
  }

  it('audio that will not start: the state needs-touch; start() again (from a touch) goes to waiting', async () => {
    const { audio, context } = stubAudio();
    const chimes = createChimes({ context: () => context });
    const h = setup({ wakePort: browserWake({ modelUrl: '/models/hey-lampas.json', ready: chimes.ready }) });
    void h.hf.start();
    await advance(1000);
    expect(h.hf.state().name).toBe('needs-touch');
    expect(h.wake.starts).toBe(0);
    expect(h.wake.liveTracks).toBe(0);
    await advance(60000);
    expect(h.wake.starts).toBe(0);
    audio.touched = true;
    void h.hf.start();
    await advance(200);
    expect(h.hf.state().name).toBe('waiting');
    expect(h.wake.starts).toBe(1);
    expect(names(h)).toEqual(['starting', 'needs-touch', 'starting', 'waiting']);
  });
});

describe('subscribe and state()', () => {
  it('tells each subscriber every state until it unsubscribes', async () => {
    const h = setup();
    const seen: string[] = [];
    const unsubscribe = h.hf.subscribe((s) => seen.push(s.name));
    expect(h.hf.state().name).toBe('off');
    await started(h);
    unsubscribe();
    await woken(h);
    expect(seen).toEqual(['starting', 'waiting']);
    expect(h.hf.state().name).toBe('listening');
    h.hf.stop();
  });
});

describe('the package', () => {
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  it('imports voice-kit/wake, only types from voice-kit/composer/listen (no React types in its .d.ts), and no React', () => {
    for (const file of readdirSync(src).filter((f) => f.endsWith('.ts'))) {
      const text = readFileSync(src + file, 'utf8');
      for (const m of text.matchAll(/^\s*(import|export)\s+(type\s+)?[^'"]*from\s+['"]([^'"]+)['"]/gm)) {
        const [, , typeOnly, specifier] = m;
        if (specifier.startsWith('./')) continue;
        if (specifier === 'voice-kit/wake') continue;
        expect([file, specifier, Boolean(typeOnly)]).toEqual([file, 'voice-kit/composer/listen', true]);
      }
      expect(text, file).not.toMatch(/from\s+['"]react/);
    }
  });
});
