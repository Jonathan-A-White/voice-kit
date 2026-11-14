// @vitest-environment jsdom
// watchThreeFingerTaps: a real three-finger tap sends one touchstart per finger (touches.length 1, 2, 3). It is a tap when exactly
// three fingers were down, none moved more than 10 px, and all were up within 400 ms of the third landing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchThreeFingerTaps } from '../src/threeFingerTap.js';

interface Finger {
  identifier: number;
  clientX: number;
  clientY: number;
}
const finger = (identifier: number, x = 100 + identifier * 40, y = 200): Finger => ({ identifier, clientX: x, clientY: y });

function fire(target: Element | Document, type: string, touches: Finger[], changed: Finger[]): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { touches: { value: touches }, targetTouches: { value: touches }, changedTouches: { value: changed } });
  target.dispatchEvent(event);
}

let stops: Array<() => void> = [];
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="page"><button id="plain">plain</button><div id="own"><button id="inner">inner</button></div></div>';
});
afterEach(() => {
  for (const stop of stops) stop();
  stops = [];
  vi.useRealTimers();
});

const watch = (onTap = vi.fn(), options: Parameters<typeof watchThreeFingerTaps>[2] = {}) => {
  const stop = watchThreeFingerTaps(document, onTap, options);
  stops.push(stop);
  return { onTap, stop };
};
const plain = () => document.getElementById('plain')!;

function land(target: Element, count: number, wait = 0): Finger[] {
  const down: Finger[] = [];
  for (let i = 0; i < count; i++) {
    const f = finger(i);
    down.push(f);
    fire(target, 'touchstart', [...down], [f]);
    if (wait) vi.advanceTimersByTime(wait);
  }
  return down;
}
function lift(target: Element, down: Finger[]): void {
  const left = [...down];
  while (left.length) {
    const f = left.shift()!;
    fire(target, 'touchend', [...left], [f]);
  }
}

describe('watchThreeFingerTaps', () => {
  it('calls onTap once for three touchstarts in turn and three ends within 400 ms', () => {
    const { onTap } = watch();
    const down = land(plain(), 3, 30);
    vi.advanceTimersByTime(100);
    lift(plain(), down);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('can be tapped again after a tap', () => {
    const { onTap } = watch();
    for (let i = 0; i < 2; i++) {
      lift(plain(), land(plain(), 3));
      vi.advanceTimersByTime(1000);
    }
    expect(onTap).toHaveBeenCalledTimes(2);
  });

  it('is no tap with two fingers', () => {
    const { onTap } = watch();
    lift(plain(), land(plain(), 2));
    expect(onTap).not.toHaveBeenCalled();
  });

  it('is no tap with four fingers', () => {
    const { onTap } = watch();
    lift(plain(), land(plain(), 4));
    expect(onTap).not.toHaveBeenCalled();
  });

  it('is no tap when a finger moved 20 px, and is one when it moved 8', () => {
    const { onTap } = watch();
    let down = land(plain(), 3);
    fire(plain(), 'touchmove', down, [finger(1, 140 + 20, 200)]);
    lift(plain(), down);
    expect(onTap).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    down = land(plain(), 3);
    fire(plain(), 'touchmove', down, [finger(1, 140 + 8, 200)]);
    lift(plain(), down);
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('is no tap when the lift comes 600 ms after the third landing', () => {
    const { onTap } = watch();
    const down = land(plain(), 3);
    vi.advanceTimersByTime(600);
    lift(plain(), down);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('is no tap when a fourth finger came and went', () => {
    const { onTap } = watch();
    const down = land(plain(), 4);
    const fourth = down.pop()!;
    fire(plain(), 'touchend', [...down], [fourth]);
    lift(plain(), down);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('is no tap when the touch is cancelled', () => {
    const { onTap } = watch();
    const down = land(plain(), 3);
    fire(plain(), 'touchcancel', [], down);
    lift(plain(), down);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('stops the click that follows a tap, for a short while only', () => {
    watch();
    const clicked = vi.fn();
    plain().addEventListener('click', clicked);
    lift(plain(), land(plain(), 3));
    plain().click();
    expect(clicked).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    plain().click();
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('leaves a click alone when there was no tap', () => {
    watch();
    const clicked = vi.fn();
    plain().addEventListener('click', clicked);
    lift(plain(), land(plain(), 2));
    plain().click();
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('leaves alone a target skip() names, and its click', () => {
    const own = document.getElementById('inner')!;
    const { onTap } = watch(vi.fn(), { skip: (target) => target instanceof Element && target.closest('#own') !== null });
    const clicked = vi.fn();
    own.addEventListener('click', clicked);
    lift(own, land(own, 3));
    own.click();
    expect(onTap).not.toHaveBeenCalled();
    expect(clicked).toHaveBeenCalledTimes(1);
    lift(plain(), land(plain(), 3));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('the returned stop removes every listener', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const { onTap, stop } = watch();
    const added = add.mock.calls.length;
    expect(added).toBeGreaterThan(0);
    stop();
    expect(remove.mock.calls.length).toBe(added);
    lift(plain(), land(plain(), 3));
    expect(onTap).not.toHaveBeenCalled();
    stop();
  });
});
