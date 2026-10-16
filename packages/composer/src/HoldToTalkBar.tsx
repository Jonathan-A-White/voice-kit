// HoldToTalkBar.tsx (lifted from Postern's src/cockpit/HoldToTalkBar.tsx) — the big hold-to-talk bar: full width,
// rounded, the mic over its label. The caller says what a hold does (press, release, abort) and what the bar says;
// with `dropOnSlideOff` a finger that slides off the bar before letting go drops the hold (the bar says
// 'Let go to keep it unsent': the composer keeps the words in its box, mw-f7gmps.3) instead of sending it.
// Its look is the app's: the class bk-composer__bar, and data-state 'idle', 'listening' or 'slid'.
import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { Icon } from './icons.js';

/** How far outside the bar the finger has to go before the hold counts as slid off, so a wobble at the edge does not drop it. */
export const SLIDE_OFF_MARGIN_PX = 24;

export const DROP_LABEL = 'Let go to keep it unsent';

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
  className?: string;
}

export function HoldToTalkBar({ label, listening, disabled, onPress, onRelease, onAbort, dropOnSlideOff = false, dropLabel = DROP_LABEL, className }: HoldToTalkBarProps) {
  const [slid, setSlid] = useState(false);
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
    onPress();
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (!dropOnSlideOff || !listening) return;
    const box = event.currentTarget.getBoundingClientRect();
    const m = SLIDE_OFF_MARGIN_PX;
    const off = event.clientX < box.left - m || event.clientX > box.right + m || event.clientY < box.top - m || event.clientY > box.bottom + m;
    if (off !== slidNow.current) setSlidOff(off);
  };
  const lift = () => {
    const drop = slidNow.current;
    setSlidOff(false);
    if (drop) onAbort();
    else onRelease();
  };
  const cancel = () => {
    setSlidOff(false);
    onAbort();
  };
  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (!event.repeat) onPress();
  };
  const keyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' || event.key === 'Enter') onRelease();
  };

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
      data-state={slid ? 'slid' : listening ? 'listening' : 'idle'}
      className={className ? `bk-composer__bar ${className}` : 'bk-composer__bar'}
    >
      <Icon name="mic" size={26} />
      {slid ? dropLabel : label}
    </button>
  );
}
