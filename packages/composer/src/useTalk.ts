// useTalk.ts (mw-06ggew.3) — the hold-to-talk bar's press logic, and the hook that listens through it, for a caller with its
// own handler for the words (Lampas's Talk sheet, Reader, Welcome and LetterDrill: they pause the read-aloud, note the
// words as spoken, drive a drill; they are not a message box, so Composer does not fit them).
// Two layers, one press machine:
//   useBarPress  the bar's press logic and nothing else: pointer and keyboard (Space, Enter) down and up, talk 'tap' latching
//                (whisper-hid's talkPress), the slide off, and a hold delay. HoldToTalkBar draws it for a caller (the Composer)
//                that runs the hold itself.
//   useTalk      useBarPress over useBarHold (useHold.ts), the one hold the Composer runs too (mw-06ggew.14): the caller says what
//                the words do (`onWords`, which gets them however the hold ended) and what must happen around a hold
//                (`onHoldStart`, `onHoldEnd`), and gets the bar's state and handlers back. TalkBar draws it.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { monotonicNow } from './clock.js';
import { resolveSettings, type ComposerSettings, type ComposerTalk } from './settings.js';
import type { Transcriber } from './transcriber.js';
import { useBarHold, type HoldEnd, type HoldEnding, type HoldWords } from './useHold.js';

export type { HoldEnd, HoldEnding, HoldWords };

/** How far outside the bar the finger has to go before the hold counts as slid off, so a wobble at the edge does not drop it. */
export const SLIDE_OFF_MARGIN_PX = 24;

/** With talk 'tap': a press released in under this many ms latches the mic on; the next tap stops it. */
export const LATCH_MS = 350;

/**
 * idle: nothing held. waiting: down, the hold delay has not passed. held: down, listening. latched: up after a quick tap, still
 * listening. tapStop: down again on a latched listen.
 */
type Phase = 'idle' | 'waiting' | 'held' | 'latched' | 'tapStop';

/** What the bar looks like: idle, listening, latched (talk 'tap', up and still listening) or slid (the finger is off the bar). */
export type BarState = 'idle' | 'listening' | 'latched' | 'slid';

export interface BarPressOptions {
  /** The settings: talk 'hold' (the default), 'tap' or 'off'. */
  settings?: Partial<ComposerSettings>;
  /** True while a hold is going on (the caller's listening). */
  listening: boolean;
  /** A hold begins: the finger (or key) is down, and the delay, if any, has passed. */
  onPress: () => void;
  /** The finger comes up normally (or a latched listen is tapped to stop). */
  onRelease: () => void;
  /** The press is over without sending: a slide off, or the phone taking the touch. */
  onAbort: () => void;
  /** A finger that slides off the bar before letting go drops the hold (onAbort) instead of releasing it. */
  dropOnSlideOff?: boolean;
  /**
   * How long a press waits, in ms, before the hold begins (onPress). Let go sooner, or slid off, it is no hold: nothing is called.
   * Applies to talk 'hold'; with talk 'tap' a press begins at once, since a tap shorter than LATCH_MS is the point.
   */
  holdDelayMs?: number;
}

/** The handlers to spread on the bar's button. */
export interface BarHandlers {
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onContextMenu: (event: { preventDefault(): void }) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onKeyUp: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

export interface BarPress {
  talk: ComposerTalk;
  state: BarState;
  /** The finger is off the bar (with dropOnSlideOff): the bar says the words will be kept unsent. */
  slid: boolean;
  /** talk 'tap': the mic was left on by a quick tap, or that listen is being tapped to stop. */
  latched: boolean;
  handlers: BarHandlers;
}

export function useBarPress({ settings, listening, onPress, onRelease, onAbort, dropOnSlideOff = false, holdDelayMs = 0 }: BarPressOptions): BarPress {
  const { talk } = resolveSettings({ settings });
  const tap = talk === 'tap';
  const delay = tap ? 0 : holdDelayMs;
  const [slid, setSlid] = useState(false);
  // The phase is a ref for the handlers (an event can follow another before a render) and state for the screen.
  const [shown, setShown] = useState<Phase>('idle');
  const phase = useRef<Phase>('idle');
  const pressedAt = useRef(0);
  const wait = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Whether a finger (or key) is down now, so a mouse moving over a latched bar is not a slide off.
  const isDown = useRef(false);
  const listeningNow = useRef(listening);
  listeningNow.current = listening;
  // The delay's timer fires later: it calls what the last render was given.
  const latest = useRef({ onPress, onRelease, onAbort });
  latest.current = { onPress, onRelease, onAbort };
  // The listen ended by itself (a failure, the app hidden): nothing stays latched.
  useEffect(() => {
    if (listening) return;
    phase.current = 'idle';
    setShown('idle');
  }, [listening]);
  useEffect(() => () => clearTimeout(wait.current), []);
  // Read when the finger lifts, which can be before the state above has re-rendered.
  const slidNow = useRef(false);
  const setSlidOff = (value: boolean) => {
    slidNow.current = value;
    setSlid(value);
  };

  function setPhase(next: Phase) {
    phase.current = next;
    setShown(next);
  }

  function begin() {
    pressedAt.current = monotonicNow();
    setPhase('held');
    latest.current.onPress();
  }

  /** A finger (or Space/Enter) goes down. On a latched listen (talk 'tap') it is the tap that will stop it. */
  function down() {
    if (talk === 'off') return;
    isDown.current = true;
    if (tap && phase.current === 'latched' && listeningNow.current) {
      setPhase('tapStop');
      return;
    }
    if (phase.current !== 'idle' && phase.current !== 'latched') return;
    if (delay > 0) {
      setPhase('waiting');
      wait.current = setTimeout(begin, delay);
      return;
    }
    begin();
  }

  /** The finger comes up normally. */
  function up() {
    isDown.current = false;
    const was = phase.current;
    if (was === 'idle' || was === 'latched') return;
    if (was === 'waiting') {
      // let go before the delay: no hold was begun, so nothing is called
      clearTimeout(wait.current);
      setPhase('idle');
      return;
    }
    // a quick press with talk 'tap' leaves the mic on, when there is a listen to leave on
    if (tap && was === 'held' && monotonicNow() - pressedAt.current < LATCH_MS && listeningNow.current) {
      setPhase('latched');
      return;
    }
    setPhase('idle');
    latest.current.onRelease();
  }

  /** The press is over without sending: a slide off, or the phone taking the touch. */
  function abort() {
    isDown.current = false;
    if (phase.current === 'idle') return;
    clearTimeout(wait.current);
    const was = phase.current;
    setPhase('idle');
    if (was !== 'waiting') latest.current.onAbort();
  }

  const handlers: BarHandlers = {
    onPointerDown: (event) => {
      try {
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } catch {
        // a pointer that is already gone: the press still counts
      }
      setSlidOff(false);
      down();
    },
    onPointerMove: (event) => {
      if (!dropOnSlideOff || !isDown.current) return;
      const waiting = phase.current === 'waiting';
      if (!listeningNow.current && !waiting) return;
      const box = event.currentTarget.getBoundingClientRect();
      const m = SLIDE_OFF_MARGIN_PX;
      const off = event.clientX < box.left - m || event.clientX > box.right + m || event.clientY < box.top - m || event.clientY > box.bottom + m;
      // slid off before the hold has begun: the wait is over, there is no hold to keep unsent
      if (waiting) {
        if (off) abort();
        return;
      }
      if (off !== slidNow.current) setSlidOff(off);
    },
    onPointerUp: () => {
      const drop = slidNow.current;
      setSlidOff(false);
      if (drop) abort();
      else up();
    },
    onPointerCancel: () => {
      setSlidOff(false);
      abort();
    },
    onContextMenu: (event) => event.preventDefault(),
    onKeyDown: (event) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      if (!event.repeat) down();
    },
    onKeyUp: (event) => {
      if (event.key === ' ' || event.key === 'Enter') up();
    },
  };

  const latched = listening && (shown === 'latched' || shown === 'tapStop');
  const state: BarState = slid ? 'slid' : listening && shown === 'latched' ? 'latched' : listening ? 'listening' : 'idle';
  return { talk, state, slid, latched, handlers };
}

export interface TalkOptions {
  /**
   * Gets the words of every hold, once, however it ended (mw-06ggew.14), not for a hold that heard nothing. `words.status` 'heard':
   * he let go and the recogniser settled them, words to send. 'kept': the hold ended any other way (`words.ended`: a slide off or
   * the phone taking the touch 'cancel', the recogniser failing 'error' or ending by itself 'ended', the page hidden 'hidden'), or
   * a release settled blank: the words heard so far, his, to keep unsent (the Composer puts them in its box) rather than lose.
   */
  onWords: (text: string, words: HoldWords) => void;
  /** A hold begins (after the hold delay), before the microphone opens: pause what is playing, say. Always followed by onHoldEnd. */
  onHoldStart?: () => void;
  /**
   * The hold is over: after the last words are in (just before onWords), or at once when it was cancelled (slid off, the phone
   * took the touch, the recogniser failed or ended by itself, the page was hidden, the hold could not start); `ended` says which.
   * Give back what onHoldStart took.
   */
  onHoldEnd?: (end: HoldEnd) => void;
  /** How audio becomes text: the browser's recogniser unless given (transcriber.ts). */
  transcriber?: Transcriber;
  /** The language to listen for; `settings.lang`, else the page's own. */
  lang?: string;
  /**
   * Hear `lang` or nothing (mw-fu7dqf.3): the hold never walks on to en-US or the browser's default language. A phone that cannot
   * hear `lang` ends the hold with `talk.failure.kind` 'language-not-supported' and a notice naming the language.
   */
  strictLang?: boolean;
  /** The app's name, for the messages that say how to allow the microphone. */
  appName?: string;
  /** How long a press waits before listening starts, in ms (talk 'hold'). Let go sooner, it is no hold. */
  holdDelayMs?: number;
  /** A finger that slides off the bar drops the hold. True unless given. */
  dropOnSlideOff?: boolean;
}

export type Talk = ReturnType<typeof useTalk>;

export function useTalk(settings: Partial<ComposerSettings> | undefined, options: TalkOptions) {
  const { onWords, onHoldStart, onHoldEnd, transcriber, lang, strictLang, appName, holdDelayMs, dropOnSlideOff = true } = options;
  const { lang: settingsLang } = resolveSettings({ settings });
  // the one hold (useBarHold), as the Composer's: whatever ends it, the words heard so far come to onWords
  const hold = useBarHold({ transcriber, lang: lang ?? settingsLang, strictLang, appName, onWords, onHoldStart, onHoldEnd });
  const { holding, press: begin, release, cancel } = hold;
  const onPress = useCallback(() => void begin(), [begin]);

  const press = useBarPress({
    settings,
    listening: holding,
    onPress,
    onRelease: () => void release(),
    onAbort: cancel,
    dropOnSlideOff,
    holdDelayMs,
  });

  return {
    /** talk: 'hold', 'tap' or 'off' (the bar renders nothing, and no hold starts). */
    talk: press.talk,
    /** A hold is going on (down, or latched). */
    listening: holding,
    state: press.state,
    slid: press.slid,
    latched: press.latched,
    /** The words so far in this hold. */
    transcript: hold.transcript,
    /** Why a hold could not start or went wrong, worded for him; clear with `setNotice(undefined)`. */
    notice: hold.notice,
    setNotice: hold.setNotice,
    /** The error the last hold failed with (`failure.kind`, say 'language-not-supported' or 'permission-denied'); cleared by the next hold. */
    failure: hold.failure,
    /** 'starting' until the recogniser says the microphone is open. */
    mic: hold.mic,
    mode: hold.mode,
    input: hold.input,
    fellBack: hold.fellBack,
    /** False on a phone with no recogniser. */
    supported: hold.supported,
    /** Spread on the bar's button. */
    bar: press.handlers,
  };
}
