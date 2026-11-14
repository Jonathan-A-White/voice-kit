// react.tsx: the React entry of @voice-kit/handsfree. useHandsFree(session) is the session's state, re-rendered on each change;
// useThreeFingerTap(onTap, options) listens on the document; HandsFreeMark is the small microphone mark that shows the state by a
// data-state attribute the stylesheet (voice-kit/handsfree/styles.css) draws. The session itself is framework-free (./session.ts).
import { useEffect, useRef, useSyncExternalStore, type MouseEventHandler } from 'react';
import type { HandsFree, HandsFreeState, HandsFreeStateName } from './session.js';
import { watchThreeFingerTaps, type ThreeFingerTapOptions } from './threeFingerTap.js';

export type { HandsFreeState, HandsFreeStateName } from './session.js';
export type { ThreeFingerTapOptions } from './threeFingerTap.js';

/** What useHandsFree reads: a HandsFree, or anything with its state() and subscribe(). */
export type HandsFreeSource = Pick<HandsFree, 'state' | 'subscribe'>;

/** The session's state now; the component re-renders on each change. Pass the same session each render (hold it in a ref, a module or a memo). */
export function useHandsFree(session: HandsFreeSource): HandsFreeState {
  return useSyncExternalStore(
    (onChange) => session.subscribe(onChange),
    () => session.state(),
    () => session.state(),
  );
}

/**
 * Calls `onTap` for each three-finger tap anywhere on the page, until the component unmounts. The latest `onTap` is the one called,
 * so it need not be memoised; `options.skip` leaves alone an element with finger gestures of its own.
 */
export function useThreeFingerTap(onTap: () => void, options: ThreeFingerTapOptions = {}): void {
  const latest = useRef({ onTap, skip: options.skip });
  latest.current = { onTap, skip: options.skip };
  const now = options.now;
  useEffect(
    () =>
      watchThreeFingerTaps(document, () => latest.current.onTap(), {
        skip: (target) => latest.current.skip?.(target) ?? false,
        ...(now ? { now } : {}),
      }),
    [now],
  );
}

export interface HandsFreeMarkProps {
  /** The session's state (from useHandsFree), or just its name. */
  state: HandsFreeState | HandsFreeStateName;
  /** The accessible name, in the app's words and language ('Hands-free: listening'). Required: the mark has no text of its own. */
  label: string;
  /** Given, the mark is a button (touch it to start from needs-touch, or to stop); otherwise a plain image. */
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
}

/** The microphone's shape, 24 x 24. */
const MIC = 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-6 9a6 6 0 0 0 12 0M12 18v3M9 21h6';

/**
 * A small microphone mark that draws the state by `data-state`: off, starting, waiting, listening, working, follow-up, needs-touch or
 * failed. It has no colour of its own: the stylesheet gives it one for each state by CSS variables, so each app themes it.
 */
export function HandsFreeMark({ state, label, onClick, className }: HandsFreeMarkProps) {
  const name = typeof state === 'string' ? state : state.name;
  const classes = className ? `bk-handsfree ${className}` : 'bk-handsfree';
  const icon = (
    <svg
      className="bk-handsfree__icon"
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable="false"
    >
      <path d={MIC} />
    </svg>
  );
  if (onClick) {
    return (
      <button type="button" className={classes} data-state={name} aria-label={label} onClick={onClick}>
        {icon}
      </button>
    );
  }
  return (
    <span className={classes} data-state={name} role="img" aria-label={label}>
      {icon}
    </span>
  );
}
