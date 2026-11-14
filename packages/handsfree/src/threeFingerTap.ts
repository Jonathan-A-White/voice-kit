// threeFingerTap.ts: a three-finger tap, counted as the fingers land. A real one sends one touchstart per finger (touches.length 1,
// then 2, then 3). It is a tap when exactly three fingers were down, none moved more than 10 px, and every one was up within 400 ms
// of the third landing. A fourth finger, a move, a slow lift or a cancelled touch is no tap. Some phones send a click after it: that
// click is dropped. An element with finger gestures of its own is left alone, by `skip`.

/** How far a finger may move and still be part of a tap, in px. */
export const TAP_MOVE_PX = 10;
/** How long after the third finger lands all three must be up, in ms. */
export const TAP_WITHIN_MS = 400;
/** How long after a tap a click is dropped, in ms. */
export const CLICK_DROP_MS = 700;

export interface ThreeFingerTapOptions {
  /** Called with the element a touch started on; true leaves that touch alone (an element with finger gestures of its own: a map, a pinch-zoom area). */
  skip?(target: EventTarget | null): boolean;
  /** The clock in ms. Default performance.now (Date.now where there is none), so fake timers move it. */
  now?(): number;
}

interface TouchPoint {
  identifier: number;
  clientX: number;
  clientY: number;
}
interface TouchLike {
  readonly length: number;
  readonly [index: number]: TouchPoint;
}
type TouchEventLike = Event & { touches?: TouchLike; changedTouches?: TouchLike };

const points = (list: TouchLike | undefined): TouchPoint[] => (list ? Array.from({ length: list.length }, (_, i) => list[i]) : []);

const defaultNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Calls onTap for each three-finger tap on `element` (the document, usually). Returns how to stop: every listener is removed. */
export function watchThreeFingerTaps(element: EventTarget, onTap: () => void, options: ThreeFingerTapOptions = {}): () => void {
  const now = options.now ?? defaultNow;
  const starts = new Map<number, TouchPoint>(); // each finger down now, where it landed
  let most = 0; // the most fingers down at once in this touch
  let thirdAt = -1;
  let ruined = false; // a fourth finger, a move, a cancel
  let skipped = false;
  let dropClicksUntil = -Infinity;

  const reset = (): void => {
    starts.clear();
    most = 0;
    thirdAt = -1;
    ruined = false;
    skipped = false;
  };

  const onStart = (event: Event): void => {
    const e = event as TouchEventLike;
    const down = points(e.touches);
    if (down.length <= points(e.changedTouches).length) {
      // the first finger of a new touch (or all of them at once)
      reset();
      skipped = options.skip?.(event.target) ?? false;
    }
    if (skipped) return;
    for (const p of points(e.changedTouches)) starts.set(p.identifier, p);
    most = Math.max(most, down.length, starts.size);
    if (down.length === 3 && thirdAt < 0) thirdAt = now();
    if (down.length > 3) ruined = true;
  };

  const onMove = (event: Event): void => {
    if (skipped || ruined) return;
    for (const p of points((event as TouchEventLike).changedTouches)) {
      const from = starts.get(p.identifier);
      if (from && Math.hypot(p.clientX - from.clientX, p.clientY - from.clientY) > TAP_MOVE_PX) ruined = true;
    }
  };

  const onEnd = (event: Event): void => {
    if (skipped) return;
    const e = event as TouchEventLike;
    if (points(e.touches).length > 0) return; // some finger is still down
    const tap = !ruined && most === 3 && thirdAt >= 0 && now() - thirdAt <= TAP_WITHIN_MS;
    reset();
    if (!tap) return;
    dropClicksUntil = now() + CLICK_DROP_MS;
    onTap();
  };

  const onCancel = (): void => {
    reset();
  };

  const onClick = (event: Event): void => {
    if (skipped || now() > dropClicksUntil) return;
    if (options.skip?.(event.target)) return;
    dropClicksUntil = -Infinity;
    event.stopPropagation();
    event.stopImmediatePropagation();
    event.preventDefault();
  };

  const passive = { passive: true } as const;
  element.addEventListener('touchstart', onStart, passive);
  element.addEventListener('touchmove', onMove, passive);
  element.addEventListener('touchend', onEnd, passive);
  element.addEventListener('touchcancel', onCancel, passive);
  element.addEventListener('click', onClick, true);
  return () => {
    element.removeEventListener('touchstart', onStart);
    element.removeEventListener('touchmove', onMove);
    element.removeEventListener('touchend', onEnd);
    element.removeEventListener('touchcancel', onCancel);
    element.removeEventListener('click', onClick, true);
    reset();
  };
}
