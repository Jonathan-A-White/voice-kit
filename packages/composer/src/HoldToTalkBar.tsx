// HoldToTalkBar.tsx (lifted from Postern's src/cockpit/HoldToTalkBar.tsx) — the big hold-to-talk bar: full width,
// rounded, the mic over its label. The caller says what a hold does (press, release, abort) and what the bar says;
// with `dropOnSlideOff` a finger that slides off the bar before letting go drops the hold (the bar says
// 'Let go to keep it unsent': the composer keeps the words in its box, mw-f7gmps.3) instead of sending it.
// Its look is the app's: the class bk-composer__bar, and data-state 'idle', 'listening', 'latched' or 'slid'.
// With settings.talk 'tap' (mw-06ggew.2) it works as whisper-hid's talkPress does: a press shorter than LATCH_MS leaves
// the mic on (latched; the bar says how to stop) and the next tap stops it; a longer press is a hold, as ever.
// With talk 'off' it renders nothing.
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Icon } from './icons.js';
import { resolveSettings, type ComposerSettings } from './settings.js';

/** How far outside the bar the finger has to go before the hold counts as slid off, so a wobble at the edge does not drop it. */
export const SLIDE_OFF_MARGIN_PX = 24;

export const DROP_LABEL = 'Let go to keep it unsent';

/** With talk 'tap': a press released in under this many ms latches the mic on; the next tap stops it. */
export const LATCH_MS = 350;

export const STOP_LABEL = 'Tap to stop';

/** idle: nothing held. held: down, listening. latched: up after a quick tap, still listening. tapStop: down again on a latched listen. */
type Phase = 'idle' | 'held' | 'latched' | 'tapStop';

export interface HoldToTalkBarProps {
  /** What a hold will do (or why it cannot be held now). */
  label: string;
  /** True while the bar is held. */
  listening: boolean;
  disabled: boolean;
  onPress: () => void;
  onRelease: () => void;
  onAbort: () => void;
  dropOnSlideOff?: boolean;
  /** What the bar says while the finger is off it (with `dropOnSlideOff`). */
  dropLabel?: string;
  /** What the bar says while the mic is kept on after a quick tap (talk 'tap'): how to stop. */
  latchedLabel?: string;
  /** The bar's settings (talk: 'hold' by default, 'tap' to latch, 'off' for no bar). */
  settings?: Partial<ComposerSettings>;
  className?: string;
}

export function HoldToTalkBar({ label, listening, disabled, onPress, onRelease, onAbort, dropOnSlideOff = false, dropLabel = DROP_LABEL, latchedLabel = STOP_LABEL, settings, className }: HoldToTalkBarProps) {
  const { talk } = resolveSettings({ settings });
  const tap = talk === 'tap';
  const [slid, setSlid] = useState(false);
  // The phase is a ref for the handlers (an event can follow another before a render) and state for the screen.
  const [shown, setShown] = useState<Phase>('idle');
  const phase = useRef<Phase>('idle');
  const pressedAt = useRef(0);
  // Whether a finger (or key) is down now, so a mouse moving over a latched bar is not a slide off.
  const isDown = useRef(false);
  const listeningNow = useRef(listening);
  listeningNow.current = listening;
  // The listen ended by itself (a failure, the app hidden): nothing stays latched.
  useEffect(() => {
    if (listening) return;
    phase.current = 'idle';
    setShown('idle');
  }, [listening]);
  // Read when the finger lifts, which can be before the state above has re-rendered.
  const slidNow = useRef(false);
  const setSlidOff = (value: boolean) => {
    slidNow.current = value;
    setSlid(value);
  };

  const press = (event: PointerEvent<HTMLButtonElement>) => {
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // a pointer that is already gone: the press still counts
    }
    setSlidOff(false);
    down();
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dropOnSlideOff || !listening || !isDown.current) return;
    const box = event.currentTarget.getBoundingClientRect();
    const m = SLIDE_OFF_MARGIN_PX;
    const off = event.clientX < box.left - m || event.clientX > box.right + m || event.clientY < box.top - m || event.clientY > box.bottom + m;
    if (off !== slidNow.current) setSlidOff(off);
  };
  const lift = () => {
    const drop = slidNow.current;
    setSlidOff(false);
    if (drop) abort();
    else up();
  };
  const cancel = () => {
    setSlidOff(false);
    abort();
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (!event.repeat) down();
  };
  const keyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' || event.key === 'Enter') up();
  };

  function setPhase(next: Phase) {
    phase.current = next;
    setShown(next);
  }

  /** A finger (or Space/Enter) goes down. On a latched listen (talk 'tap') it is the tap that will stop it. */
  function down() {
    isDown.current = true;
    if (tap && phase.current === 'latched' && listeningNow.current) {
      setPhase('tapStop');
      return;
    }
    if (phase.current === 'held' || phase.current === 'tapStop') return;
    pressedAt.current = Date.now();
    setPhase('held');
    onPress();
  }

  /** The finger comes up normally. */
  function up() {
    isDown.current = false;
    const was = phase.current;
    if (was === 'idle' || was === 'latched') return;
    // a quick press with talk 'tap' leaves the mic on, when there is a listen to leave on
    if (tap && was === 'held' && Date.now() - pressedAt.current < LATCH_MS && listeningNow.current) {
      setPhase('latched');
      return;
    }
    setPhase('idle');
    onRelease();
  }

  /** The press is over without sending: a slide off, or the phone taking the touch. */
  function abort() {
    isDown.current = false;
    if (phase.current === 'idle') return;
    setPhase('idle');
    onAbort();
  }

  if (talk === 'off') return null;

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={press}
      onPointerMove={move}
      onPointerUp={lift}
      onPointerCancel={cancel}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={keyDown}
      onKeyUp={keyUp}
      data-state={slid ? 'slid' : listening && shown === 'latched' ? 'latched' : listening ? 'listening' : 'idle'}
      className={className ? `bk-composer__bar ${className}` : 'bk-composer__bar'}
    >
      <Icon name="mic" size={26} />
      {slid ? dropLabel : listening && (shown === 'latched' || shown === 'tapStop') ? latchedLabel : label}
    </button>
  );
}
