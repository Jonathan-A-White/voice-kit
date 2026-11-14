// The spike page's Hands-free check: the REAL hands-free session (voice-kit/handsfree) run on the page after 'Hey Lampas', so
// his phone can say whether Android Chrome's speech recogniser hears him while the wake detector holds the microphone
// ('share': the recogniser listens on a clone of the detector's track) or only after the detector has let it go ('handover').
// The page's own audio element is paused at the wake and played at the close if it was playing, as an app will do.
//
// This file holds the panel's logic over injected ports (the wake, the listen, the audio, the log, the clock), so it is tested
// with no browser (tests/handsfree-check.test.ts). It wraps the ports it is given only to watch them: it adds no behaviour of
// its own to the session. One log entry per exchange, made when the exchange closes:
//   way, pauseMs, openMs (from the wake to the recogniser saying the microphone is open), words, error (the recogniser's error
//   kind), closed (why the session closed), trackEnded and trackMuted (the detector's track, from the wake to the close) and
//   wakeAgain ('not yet' until the next wake, then 'yes': the same entry is updated).
import { createHandsFree } from 'voice-kit/handsfree';
import type { ChimePort, HandsFree, HandsFreeClock, HandsFreeState, ListenPort, MicWay, WakePort } from 'voice-kit/handsfree';
import type { LogEntry } from './log.js';

/** The page's own audio element, as the check needs it. */
export interface AudioPort {
  isPlaying(): boolean;
  pause(): void;
  play(): void | Promise<void>;
}

/** The part of the page's log the check uses. */
export interface CheckLog {
  add(event: string, detail?: Record<string, unknown>): LogEntry;
  update(entry: LogEntry, detail: Record<string, unknown>): LogEntry;
}

export interface HandsFreeCheckPorts {
  /** The wake: the page's own (its detector over the chosen input) or voice-kit/handsfree's browserWake. */
  wake: WakePort;
  /** The app's listen: composer's startListening. */
  listen: ListenPort;
  audio: AudioPort;
  /** The open and close chimes (voice-kit/handsfree's createChimes()); none: no sound. */
  chime?: ChimePort;
  log: CheckLog;
  /** The way the microphone is handed to the recogniser, read when the session starts. */
  way(): MicWay;
  /** The pause that ends his words, in ms, read at each command. */
  pauseMs(): number;
  /** The session's own timers; the global ones by default. */
  clock?: HandsFreeClock;
  /** Milliseconds on a monotonic clock; performance.now by default. */
  now?: () => number;
  /** Called after every change of what the panel shows. */
  onChange?(view: CheckView): void;
}

/** What the panel shows. */
export interface CheckView {
  /** The session's state in words. */
  state: string;
  /** The words of the command now being heard or last heard. */
  heard: string;
  /** The last exchange, as one sentence; the empty string before the first. */
  last: string;
}

export interface HandsFreeCheck {
  /** Starts the session with the way chosen now. Resolves when the wake listens or could not. */
  start(): Promise<void>;
  /** Stops it: an open exchange is closed and logged, nothing is left open. */
  stop(): void;
  state(): HandsFreeState;
  view(): CheckView;
}

/** One exchange as the entry holds it. */
interface Exchange {
  wakeAt: number;
  pauseMs: number;
  openMs: number | null;
  words: string | null;
  error: string | null;
  trackEnded: boolean;
  trackMuted: boolean;
  /** The page's audio was playing at the wake and the check paused it. */
  pausedByUs: boolean;
}

/** The entry's detail as one plain sentence for the panel. */
export function describeEntry(detail: Record<string, unknown>): string {
  const open = typeof detail.openMs === 'number' ? `opened in ${detail.openMs} ms` : 'the recogniser did not open';
  const closed = typeof detail.closed === 'string' ? detail.closed : 'closed';
  const outcome = typeof detail.words === 'string' ? `heard "${detail.words}"` : detail.error ? `error: ${String(detail.error)} (${closed})` : `heard nothing (${closed})`;
  const track = detail.trackEnded ? "the detector's track ended" : detail.trackMuted ? "the detector's track went mute" : "the detector's track stayed open";
  return `${String(detail.way)}: ${open}; ${outcome}; ${track}; wake heard again: ${String(detail.wakeAgain)}`;
}

const NAMES: Record<string, string> = {
  off: 'Off.',
  starting: 'Starting…',
  waiting: 'Waiting for "Hey Lampas".',
  'needs-touch': 'The audio needs a touch first.',
  listening: 'Listening to you.',
  working: 'Working on it.',
  'follow-up': 'Listening for more.',
};

function describeState(state: HandsFreeState): string {
  if (state.name === 'failed') return `Could not run (${state.kind}): ${state.message}`;
  return NAMES[state.name] ?? state.name;
}

/** The panel's logic: the real session, watched, with one log entry per exchange. */
export function createHandsFreeCheck(ports: HandsFreeCheckPorts): HandsFreeCheck {
  const now = ports.now ?? (() => performance.now());
  const clock: HandsFreeClock = ports.clock ?? { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>) };
  let session: HandsFree | undefined;
  let way: MicWay = 'handover';
  let exchange: Exchange | undefined;
  let lastWakeAt = 0;
  /** The last exchange's entry, until the wake is heard again. */
  let waiting: { entry: LogEntry; detail: Record<string, unknown> } | undefined;
  /** The last close was a recogniser error: if it left the session failed, the check starts it again. */
  let restartIfFailed = false;
  const view: CheckView = { state: NAMES.off, heard: '', last: '' };
  const changed = () => ports.onChange?.({ ...view });

  /** Watches the detector's track from the wake to the close. */
  function watch(track: MediaStreamTrack | undefined): () => void {
    if (!track || typeof track.addEventListener !== 'function') return () => undefined;
    const onEnded = () => {
      if (exchange) exchange.trackEnded = true;
    };
    const onMute = () => {
      if (exchange) exchange.trackMuted = true;
    };
    track.addEventListener('ended', onEnded);
    track.addEventListener('mute', onMute);
    return () => {
      track.removeEventListener('ended', onEnded);
      track.removeEventListener('mute', onMute);
    };
  }

  function noteWake(): void {
    lastWakeAt = now();
    if (!waiting) return;
    const detail = { ...waiting.detail, wakeAgain: 'yes' };
    waiting.entry = ports.log.update(waiting.entry, { wakeAgain: 'yes' });
    waiting = undefined;
    view.last = describeEntry(detail);
    changed();
  }

  const wake: WakePort = {
    async start(onWake) {
      const result = await ports.wake.start(() => {
        noteWake();
        onWake();
      });
      if (!result.ok) return result;
      const unwatch = watch(result.track);
      return {
        ...result,
        stop() {
          unwatch();
          result.stop();
        },
      };
    },
  };

  const listen: ListenPort = (options) =>
    ports.listen({
      ...options,
      onStart() {
        if (exchange && exchange.openMs === null) exchange.openMs = Math.round(now() - exchange.wakeAt);
        options.onStart?.();
      },
      onError(error) {
        if (exchange && exchange.error === null) exchange.error = error.kind;
        options.onError?.(error);
      },
    });

  function onOpen(): void {
    exchange = { wakeAt: lastWakeAt || now(), pauseMs: ports.pauseMs(), openMs: null, words: null, error: null, trackEnded: false, trackMuted: false, pausedByUs: false };
    view.heard = '';
    if (ports.audio.isPlaying()) {
      exchange.pausedByUs = true;
      ports.audio.pause();
    }
    changed();
  }

  function onClose(info: { reason: string }): void {
    const done = exchange;
    exchange = undefined;
    if (!done) return;
    const detail: Record<string, unknown> = {
      way,
      pauseMs: done.pauseMs,
      openMs: done.openMs,
      words: done.words,
      error: done.error,
      closed: info.reason,
      trackEnded: done.trackEnded,
      trackMuted: done.trackMuted,
      wakeAgain: 'not yet',
    };
    waiting = { entry: ports.log.add('hands-free-check', detail), detail };
    view.last = describeEntry(detail);
    restartIfFailed = info.reason === 'listen-error';
    if (done.pausedByUs) {
      try {
        void Promise.resolve(ports.audio.play()).catch(() => undefined);
      } catch {
        // the page's player refused: the entry already says what happened
      }
    }
    changed();
  }

  function onState(state: HandsFreeState): void {
    view.state = describeState(state);
    changed();
    // A recogniser that cannot run here fails the session; the check is a probe, so it goes on listening for the wake
    // (each try needs his wake word, so this cannot loop on its own).
    if (state.name === 'failed' && restartIfFailed) {
      restartIfFailed = false;
      const mine = session;
      clock.setTimeout(() => {
        if (session === mine) void mine?.start();
      }, 0);
    }
  }

  return {
    async start() {
      session?.stop();
      way = ports.way();
      restartIfFailed = false;
      session = createHandsFree(
        {
          wake,
          listen,
          ...(ports.chime ? { chime: ports.chime } : {}),
          onOpen,
          onCommand(words) {
            if (exchange) exchange.words = words;
            view.heard = words;
            changed();
            return { followUp: false };
          },
          onClose,
          onState,
          ...(ports.clock ? { clock: ports.clock } : {}),
        },
        { mic: way, pauseMs: () => ports.pauseMs() },
      );
      await session.start();
    },
    stop() {
      const stopping = session;
      session = undefined;
      stopping?.stop();
      view.state = NAMES.off;
      changed();
    },
    state: () => session?.state() ?? { name: 'off' },
    view: () => ({ ...view }),
  };
}
