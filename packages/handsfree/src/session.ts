// session.ts: the hands-free session, a plain state machine over injected ports and an injected clock, so every order of
// events can be run on fake time. One exchange goes: a wake; onOpen (the app silences its sound) BEFORE any microphone opens
// for the command; the microphone opened for the command (in 'handover' the wake's stream is closed first and the recogniser
// opens the microphone itself, as a hold does; in 'share' the recogniser is started on a clone of the wake's own track, through
// listen's openInput, and the wake runs on with its wakes ignored); the open chime when, and only when, the recogniser says the
// microphone is open ('speak now'); the words, until nothing has changed for pauseMs after the first ones; onCommand with them.
// The app resolves onCommand when it has done and said all it will, asking for a follow-up or not: a follow-up opens the
// microphone again with no chime and takes words within followUpMs to their own silence; no words, the lower close chime. Then
// onClose, once, and the wake listens again.
//
// While onCommand is pending (working) the wake listens (in 'handover' it is opened again for that), so 'Hey Lampas' over an
// answer calls onInterrupt and opens a new command in the same exchange, unless onInterrupt returns false.
//
// Every way an exchange can end leaves nothing open: no recogniser (its session is aborted) and no microphone track (the wake is
// stopped, a clone is closed by listen's input close), and onClose is called if onOpen was. The ends: the command done, no words
// (noSpeechMs after the chime, followUpMs in a follow-up), a recogniser error, a recogniser that does not open in openTimeoutMs,
// onCommand throwing, stop(), the page hidden. A page visible again starts the wake again if the session is on. A microphone
// refused or a page that cannot run the wake is a failed state with its kind, never a retry loop; audio that cannot start
// without a touch is needs-touch, and start() called again from a touch goes on.
//
// Every async step checks it still belongs to the live run and exchange (a stop, a hide or a new command makes it stale), so a
// late answer from the wake, the recogniser or onCommand can never reopen what was closed.
import type { ListenError, ListenErrorKind, ListenOptions, ListenSession, ListenStart, MicInput } from 'voice-kit/composer';

/** Why the session could not run: the wake's own kinds. */
export type HandsFreeFailureKind = 'not-supported' | 'permission-denied' | 'no-microphone' | 'other';

export type HandsFreeStateName = 'off' | 'starting' | 'waiting' | 'needs-touch' | 'listening' | 'working' | 'follow-up' | 'failed';

/**
 * Where the session is. off: nothing listens (hidden: true when it is off only because the page is hidden; it starts again when
 * the page is visible). starting: the wake is opening. waiting: the wake listens. needs-touch: the audio will not start until
 * he touches the page; call start() from the touch. listening: the microphone is open for a command and the chime has sounded,
 * or words are coming in a follow-up. working: onCommand is carrying the words out. follow-up: the microphone is open (or
 * opening) for a follow-up and no words have come yet. failed: it cannot run; kind and message say why.
 */
export type HandsFreeState =
  | { name: 'off'; hidden?: true }
  | { name: 'starting' | 'waiting' | 'needs-touch' | 'listening' | 'working' | 'follow-up' }
  | { name: 'failed'; kind: HandsFreeFailureKind; message: string };

/** A running wake: its microphone track (needed by 'share'), and how to stop it. */
export interface WakeRunning {
  ok: true;
  track?: MediaStreamTrack;
  stop(): void;
}

/** A wake that did not start: a failure kind, or needs-touch when the audio will not start without a touch. */
export interface WakeRefused {
  ok: false;
  kind: HandsFreeFailureKind | 'needs-touch';
  message: string;
}

/** The wake word: start it (it calls onWake for each wake until stopped). */
export interface WakePort {
  start(onWake: () => void): Promise<WakeRunning | WakeRefused>;
}

/** The app's listen: composer's startListening, or anything of its shape. */
export type ListenPort = (options: ListenOptions) => ListenStart;

/** The two chimes. */
export interface ChimePort {
  open(): void;
  close(): void;
}

/** The page's visibility. */
export interface VisibilityPort {
  isHidden(): boolean;
  /** Calls `listener` when the visibility changes; returns how to stop. */
  onChange(listener: () => void): () => void;
}

/** The timers the session's own waits run on. */
export interface HandsFreeClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** What the app says when it has done a command. */
export interface CommandDone {
  /** Keep the microphone open for followUpMs for a follow-up with no wake word. */
  followUp?: boolean;
}

/**
 * Why an exchange closed. done: a command was done with no follow-up asked. no-speech: no words came within noSpeechMs of the
 * chime. follow-up-ended: no words came in the follow-up window. listen-error: the recogniser failed. no-open: the recogniser
 * did not say the microphone was open within openTimeoutMs. command-failed: onCommand threw or rejected. wake-error: the wake
 * could not be opened for the exchange ('share') . stopped: stop(). hidden: the page was hidden.
 */
export type CloseReason = 'done' | 'no-speech' | 'follow-up-ended' | 'listen-error' | 'no-open' | 'command-failed' | 'wake-error' | 'stopped' | 'hidden';

export interface HandsFreeHooks {
  /** At the wake, before any microphone opens for the command: silence what is sounding. May return a promise; the command waits for it. */
  onOpen?(): void | Promise<void>;
  /** The settled words of a command. Resolve when the app has done and said all it will; ask for a follow-up with { followUp: true }. */
  onCommand(words: string, info: { followUp: boolean }): CommandDone | void | Promise<CommandDone | void>;
  /** A wake while onCommand is pending: stop what the command is doing. Return false to refuse: no new command opens and the pending one goes on. */
  onInterrupt?(): boolean | void;
  /** Once, when an exchange whose onOpen was called is over: resume what onOpen silenced, unless the command took the sound over. */
  onClose?(info: { reason: CloseReason; kind?: ListenErrorKind }): void;
  /** Each new state. */
  onState?(state: HandsFreeState): void;
}

export interface HandsFreePorts extends HandsFreeHooks {
  wake: WakePort;
  listen: ListenPort;
  chime?: ChimePort;
  visibility?: VisibilityPort;
  clock?: HandsFreeClock;
}

export type MicWay = 'handover' | 'share';

export interface HandsFreeOptions {
  /** The silence that ends a command once words have come, in ms; a function is read at each command (his setting). Default 1500. */
  pauseMs?: number | (() => number);
  /** How long a follow-up waits for words once the microphone is open. Default 8000. */
  followUpMs?: number;
  /** How long a command waits for its first words after the chime. Default 6000. */
  noSpeechMs?: number;
  /** A command still gaining words this long after the chime is taken as ended there. Default 60000. */
  maxCommandMs?: number;
  /** How long the recogniser has to say the microphone is open. Default 3000. */
  openTimeoutMs?: number;
  /** How the command's microphone is opened: 'handover' (the default) or 'share'. See the README. */
  mic?: MicWay;
  /** Passed on to listen (lang, strictLang, appName, ...). */
  listenOptions?: Omit<ListenOptions, 'onInterim' | 'onFinal' | 'onStart' | 'onError' | 'onTransient' | 'onEnd' | 'openInput' | 'onInput' | 'onFallback'>;
}

export interface HandsFree {
  /** Turns it on (or, from needs-touch or failed, tries again). Resolves once the wake listens or could not. */
  start(): Promise<void>;
  /** Turns it off: ends any exchange (onClose if onOpen was called) and leaves no microphone or recogniser open. */
  stop(): void;
  state(): HandsFreeState;
  /** Calls `listener` with each new state; returns how to stop. */
  subscribe(listener: (state: HandsFreeState) => void): () => void;
}

export const DEFAULT_PAUSE_MS = 1500;
export const DEFAULT_FOLLOW_UP_MS = 8000;
export const DEFAULT_NO_SPEECH_MS = 6000;
export const DEFAULT_MAX_COMMAND_MS = 60000;
export const DEFAULT_OPEN_TIMEOUT_MS = 3000;

/** The kinds of recogniser error that mean it cannot listen at all here: the session fails rather than closing and waiting again. */
const FATAL_LISTEN: ReadonlySet<string> = new Set(['permission-denied', 'not-supported', 'no-microphone']);

/** The closes that mean no command came: the only ones that name a recogniser error's kind. */
const EMPTY_CLOSES: ReadonlySet<CloseReason> = new Set(['no-speech', 'follow-up-ended', 'no-open', 'listen-error']);

const defaultClock: HandsFreeClock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** One opening of the microphone for a command (after a wake or an interrupt) or a follow-up. */
interface Listening {
  followUp: boolean;
  pauseMs: number;
  session?: ListenSession;
  /** The recogniser said the microphone is open. */
  open: boolean;
  words: string;
  /** Taking the words (stop() asked) or closed: nothing more is done with this listening. */
  done: boolean;
  timers: Set<unknown>;
}

/** From a wake to onClose. */
interface Exchange {
  /** onOpen was called: onClose is owed. */
  opened: boolean;
  /** Bumped at each new command: a command's async steps and its onCommand answer are stale once it moves on. */
  command: number;
  listening?: Listening;
  /** onCommand is pending: a wake now is an interrupt. */
  working: boolean;
  /** The last error the recogniser met and went on through (no-speech, network, aborted) in this exchange's listening. */
  transient?: ListenError;
  /** The wake could not be opened again while the app worked ('handover'): the session fails when the exchange closes. */
  wakeFailure?: WakeRefused;
}

export function createHandsFree(ports: HandsFreePorts, options: HandsFreeOptions = {}): HandsFree {
  const clock = ports.clock ?? defaultClock;
  const mic: MicWay = options.mic ?? 'handover';
  const followUpMs = options.followUpMs ?? DEFAULT_FOLLOW_UP_MS;
  const noSpeechMs = options.noSpeechMs ?? DEFAULT_NO_SPEECH_MS;
  const maxCommandMs = options.maxCommandMs ?? DEFAULT_MAX_COMMAND_MS;
  const openTimeoutMs = options.openTimeoutMs ?? DEFAULT_OPEN_TIMEOUT_MS;
  const readPause = (): number => {
    const value = typeof options.pauseMs === 'function' ? options.pauseMs() : options.pauseMs;
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_PAUSE_MS;
  };

  let current: HandsFreeState = { name: 'off' };
  const listeners = new Set<(state: HandsFreeState) => void>();
  const setState = (next: HandsFreeState) => {
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    current = next;
    try {
      ports.onState?.(next);
    } catch {
      // a hook that throws does not stop the session
    }
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch {
        // nor does a subscriber
      }
    }
  };

  /** start() was called and stop() has not been since. */
  let on = false;
  /** Bumped by stop(), a hide and a failure: async steps of an older run give up. */
  let run = 0;
  let exchange: Exchange | undefined;

  // ---- the wake: its starts and stops run one after another, so a stop waits for a start in flight ----
  let wake: WakeRunning | undefined;
  let wakeQueue: Promise<unknown> = Promise.resolve();
  const queued = <T>(step: () => Promise<T>): Promise<T> => {
    const next = wakeQueue.then(step, step);
    wakeQueue = next.catch(() => undefined);
    return next;
  };
  /** Opens the wake unless it runs; stale (null) when the run moved on before it could. */
  const wakeOn = (): Promise<WakeRunning | WakeRefused | null> => {
    const mine = run;
    return queued(async () => {
      if (mine !== run) return null;
      if (wake) return wake;
      let result: WakeRunning | WakeRefused;
      const holder: { running?: WakeRunning } = {};
      try {
        result = await ports.wake.start(() => {
          if (holder.running && holder.running === wake) heardWake();
        });
      } catch (err) {
        result = { ok: false, kind: 'other', message: err instanceof Error ? err.message : String(err) };
      }
      if (!result.ok) return result;
      if (mine !== run) {
        result.stop();
        return null;
      }
      holder.running = result;
      wake = result;
      return result;
    });
  };
  const wakeOff = (): Promise<void> =>
    queued(async () => {
      const running = wake;
      wake = undefined;
      try {
        running?.stop();
      } catch {
        // already stopped
      }
    });

  // ---- timers ----
  const later = (owner: Set<unknown>, ms: number, fn: () => void) => {
    const handle = clock.setTimeout(() => {
      owner.delete(handle);
      fn();
    }, ms);
    owner.add(handle);
    return handle;
  };
  const cancel = (owner: Set<unknown>, handle: unknown) => {
    if (handle === undefined) return;
    clock.clearTimeout(handle);
    owner.delete(handle);
  };
  const cancelAll = (owner: Set<unknown>) => {
    for (const handle of owner) clock.clearTimeout(handle);
    owner.clear();
  };

  const chime = (which: 'open' | 'close') => {
    try {
      ports.chime?.[which]();
    } catch {
      // a chime that cannot sound does not end the exchange
    }
  };

  /** Puts the listening down: its timers and its recogniser (aborted even while it settles: the words are not wanted now). */
  const dropListening = (ex: Exchange) => {
    const listening = ex.listening;
    ex.listening = undefined;
    if (!listening) return;
    cancelAll(listening.timers);
    listening.done = true;
    try {
      listening.session?.abort();
    } catch {
      // already ended
    }
  };

  /** Ends the exchange: the recogniser, its timers, the close chime when asked, onClose if owed; then what comes after. */
  const endExchange = (ex: Exchange, reason: CloseReason, after: { chime: boolean; next: 'wait' | 'none' | { fail: WakeRefused | ListenError } }) => {
    if (exchange !== ex) return;
    exchange = undefined;
    ex.command++;
    ex.working = false;
    dropListening(ex);
    if (after.chime) chime('close');
    if (ex.opened) {
      ex.opened = false;
      try {
        // a close for want of words says what the recogniser kept meeting (mw-rl10piw.16)
        const kind = EMPTY_CLOSES.has(reason) ? ex.transient?.kind : undefined;
        ports.onClose?.(kind ? { reason, kind } : { reason });
      } catch {
        // the hook's failure is the app's
      }
    }
    const next = ex.wakeFailure && after.next === 'wait' ? { fail: ex.wakeFailure } : after.next;
    if (next === 'wait') void waitForWake();
    else if (next !== 'none') refuse(next.fail);
  };

  /** The session cannot go on: failed with the kind (or needs-touch), the wake stopped, no retry until start(). */
  const refuse = (why: WakeRefused | ListenError) => {
    run++;
    if (exchange) endExchange(exchange, 'wake-error', { chime: false, next: 'none' });
    void wakeOff();
    if (why.kind === 'needs-touch') setState({ name: 'needs-touch' });
    else setState({ name: 'failed', kind: failureKind(why.kind), message: why.message });
  };

  /** Opens the wake (when it is not running) and says waiting, or why it cannot. */
  const waitForWake = async () => {
    if (!on) return;
    if (ports.visibility?.isHidden()) {
      setState({ name: 'off', hidden: true });
      return;
    }
    const mine = run;
    if (!wake) setState({ name: 'starting' });
    const result = await wakeOn();
    if (mine !== run || !on || exchange || !result) return;
    if (!result.ok) refuse(result);
    else setState({ name: 'waiting' });
  };

  // ---- a wake ----
  const heardWake = () => {
    if (!on) return;
    const ex = exchange;
    if (!ex) {
      if (current.name === 'waiting') void beginExchange();
      return;
    }
    if (!ex.working) return; // listening, or opening: the wake is ignored
    let allowed: boolean | void = true;
    try {
      allowed = ports.onInterrupt?.();
    } catch {
      allowed = false;
    }
    if (allowed === false || exchange !== ex || !ex.working) return;
    ex.working = false;
    void openCommand(ex, false);
  };

  const beginExchange = async () => {
    const ex: Exchange = { opened: true, command: 0, working: false };
    exchange = ex;
    try {
      await ports.onOpen?.();
    } catch {
      // the app could not silence its sound: the command still opens
    }
    if (exchange !== ex) return;
    await openCommand(ex, false);
  };

  /** Opens the microphone for a command (after a wake or an interrupt) or a follow-up. */
  const openCommand = async (ex: Exchange, followUp: boolean) => {
    const command = ++ex.command;
    const mine = run;
    const stale = () => exchange !== ex || ex.command !== command || mine !== run;
    if (followUp) setState({ name: 'follow-up' });
    let track: MediaStreamTrack | undefined;
    if (mic === 'handover') {
      await wakeOff();
    } else {
      const running = await wakeOn();
      if (stale()) return;
      if (!running || !running.ok) {
        endExchange(ex, 'wake-error', { chime: true, next: running ? { fail: running } : 'none' });
        return;
      }
      track = running.track;
    }
    if (stale()) return;

    ex.transient = undefined;
    const listening: Listening = { followUp, pauseMs: readPause(), open: false, words: '', done: false, timers: new Set() };
    ex.listening = listening;
    const live = () => !stale() && ex.listening === listening && !listening.done;
    let pause: unknown;
    let quiet: unknown;
    // set once listen has started (onStart may come before, from a listen that answers at once)
    const opening: { handle?: unknown } = {};

    const onStart = () => {
      if (!live() || listening.open) return;
      listening.open = true;
      cancel(listening.timers, opening.handle);
      if (!followUp) {
        chime('open');
        setState({ name: 'listening' });
      }
      quiet = later(listening.timers, followUp ? followUpMs : noSpeechMs, () => {
        if (!live() || listening.words) return;
        endExchange(ex, followUp ? 'follow-up-ended' : 'no-speech', { chime: true, next: 'wait' });
      });
      later(listening.timers, maxCommandMs, () => {
        if (live()) void take();
      });
    };
    const onInterim = (text: string) => {
      if (!live()) return;
      const words = text.trim();
      if (!words || words === listening.words) return;
      if (!listening.open) onStart(); // words are proof the microphone is open
      listening.words = words;
      cancel(listening.timers, quiet);
      if (followUp && current.name === 'follow-up') setState({ name: 'listening' });
      cancel(listening.timers, pause);
      pause = later(listening.timers, listening.pauseMs, () => {
        if (live()) void take();
      });
    };
    const onTransient = (error: ListenError) => {
      if (live()) ex.transient = error;
    };
    const onError = (error: ListenError) => {
      if (!live()) return;
      ex.transient = error;
      if (listening.words) {
        void take();
        return;
      }
      if (FATAL_LISTEN.has(error.kind)) endExchange(ex, 'listen-error', { chime: true, next: { fail: error } });
      else if (error.kind === 'no-speech') endExchange(ex, followUp ? 'follow-up-ended' : 'no-speech', { chime: true, next: 'wait' });
      else endExchange(ex, 'listen-error', { chime: true, next: 'wait' });
    };
    const onEnd = () => {
      if (live()) void take();
    };
    /** The words are settled: stop the recogniser, then hand them to the app (or close, when there are none). */
    const take = async () => {
      if (!live()) return;
      listening.done = true;
      cancelAll(listening.timers);
      let text = '';
      try {
        const result = await listening.session?.stop();
        text = result?.text ?? '';
      } catch {
        // the words heard so far stand
      }
      if (exchange !== ex || ex.command !== command || mine !== run || ex.listening !== listening) return;
      ex.listening = undefined;
      const words = text.trim() || listening.words;
      if (!words) {
        endExchange(ex, followUp ? 'follow-up-ended' : 'no-speech', { chime: true, next: 'wait' });
        return;
      }
      void carryOut(ex, words, followUp);
    };

    let openInput: (() => Promise<MicInput | undefined>) | undefined;
    if (track) {
      const wakeTrack = track;
      openInput = async () => {
        const clone = wakeTrack.clone();
        return {
          label: wakeTrack.label || 'the wake microphone',
          track: clone,
          close: () => clone.stop(),
        };
      };
    }
    let started: ListenStart;
    try {
      started = ports.listen({ ...options.listenOptions, onStart, onInterim, onError, onTransient, onEnd, ...(openInput ? { openInput } : {}) });
    } catch (err) {
      started = { ok: false, error: { kind: 'other', message: err instanceof Error ? err.message : String(err) } };
    }
    if (!started.ok) {
      if (!live()) return;
      if (FATAL_LISTEN.has(started.error.kind)) endExchange(ex, 'listen-error', { chime: true, next: { fail: started.error } });
      else endExchange(ex, 'listen-error', { chime: true, next: 'wait' });
      return;
    }
    if (!live()) {
      started.session.abort();
      return;
    }
    listening.session = started.session;
    opening.handle = later(listening.timers, openTimeoutMs, () => {
      if (live() && !listening.open) endExchange(ex, 'no-open', { chime: true, next: 'wait' });
    });
  };

  /** The app carries the command out; the wake listens meanwhile, for an interrupt. */
  const carryOut = async (ex: Exchange, words: string, followUp: boolean) => {
    const command = ++ex.command;
    const mine = run;
    ex.working = true;
    setState({ name: 'working' });
    if (mic === 'handover') {
      void wakeOn().then((result) => {
        if (result && !result.ok && exchange === ex && mine === run) ex.wakeFailure = result;
      });
    }
    let done: CommandDone | void;
    try {
      done = await ports.onCommand(words, { followUp });
    } catch {
      if (exchange === ex && ex.command === command && mine === run) endExchange(ex, 'command-failed', { chime: true, next: 'wait' });
      return;
    }
    if (exchange !== ex || ex.command !== command || mine !== run) return;
    ex.working = false;
    if (done && done.followUp) {
      if (ex.wakeFailure) {
        endExchange(ex, 'wake-error', { chime: true, next: 'wait' });
        return;
      }
      void openCommand(ex, true);
    } else endExchange(ex, 'done', { chime: false, next: 'wait' });
  };

  // ---- the page's visibility ----
  let hiddenOff = false;
  const onVisibility = () => {
    if (!on) return;
    if (ports.visibility?.isHidden()) {
      if (current.name === 'failed' || current.name === 'needs-touch') return;
      run++;
      hiddenOff = true;
      if (exchange) endExchange(exchange, 'hidden', { chime: false, next: 'none' });
      void wakeOff();
      setState({ name: 'off', hidden: true });
    } else if (hiddenOff || (current.name === 'off' && 'hidden' in current)) {
      hiddenOff = false;
      void waitForWake();
    }
  };
  let unwatch: (() => void) | undefined;

  return {
    async start() {
      if (on && current.name !== 'needs-touch' && current.name !== 'failed') return;
      on = true;
      run++;
      hiddenOff = false;
      if (!unwatch && ports.visibility) unwatch = ports.visibility.onChange(onVisibility);
      await waitForWake();
    },
    stop() {
      if (!on && current.name === 'off') return;
      on = false;
      run++;
      hiddenOff = false;
      if (exchange) endExchange(exchange, 'stopped', { chime: false, next: 'none' });
      void wakeOff();
      unwatch?.();
      unwatch = undefined;
      setState({ name: 'off' });
    },
    state: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** A failure's kind as the session reports it. */
function failureKind(kind: string): HandsFreeFailureKind {
  return kind === 'not-supported' || kind === 'permission-denied' || kind === 'no-microphone' ? kind : 'other';
}
