// The wake fake (mw-rl10piw.2): with it installed the kit's own startWake opens no microphone and loads no model, and the
// handle on window.__bsvKitTesting.wake says the wake word, tells whether a wake is open, counts the starts and fails them.
// (Type-checked by packages/handsfree/tsconfig.json, which has the DOM library the wake's source needs.)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startWake } from '../../wake/src/index.js';
import type { WakeModel } from '../../wake/src/index.js';
import { watchThreeFingerTaps } from '../../handsfree/src/threeFingerTap.js';
import { installWake, threeFingerTap, wakeInitScript } from '../src/handsfree.js';
import type { WakeFake } from '../src/handsfree.js';

const registry = () => (globalThis as { __bsvKitTesting?: { wake?: WakeFake } }).__bsvKitTesting;

let getUserMedia: ReturnType<typeof vi.fn>;
let fetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  getUserMedia = vi.fn(() => Promise.reject(new Error('the fake opened a microphone')));
  fetch = vi.fn(() => Promise.reject(new Error('the fake fetched')));
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('fetch', fetch);
});
afterEach(() => {
  registry()?.wake?.uninstall();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function opened(onWake = vi.fn()) {
  const pending = startWake({ modelUrl: '/models/hey-lampas.json', onWake, fetch: fetch as unknown as typeof globalThis.fetch });
  await vi.advanceTimersByTimeAsync(100);
  return { result: await pending, onWake };
}

describe('installWake', () => {
  it('startWake calls no getUserMedia and fetches nothing', async () => {
    installWake();
    const { result } = await opened();
    expect(result.ok).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    if (result.ok) {
      expect(result.track.readyState).toBe('live');
      expect(result.stream.getAudioTracks()).toEqual([result.track]);
      result.stop();
    }
  });

  it('say() calls onWake once, with a wake', async () => {
    const wake = installWake();
    const { result, onWake } = await opened();
    expect(wake.say()).toBe(true);
    expect(onWake).toHaveBeenCalledTimes(1);
    expect(onWake.mock.calls[0][0]).toMatchObject({ score: expect.any(Number), time: expect.any(Number) });
    if (result.ok) result.stop();
    expect(wake.say()).toBe(false);
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it('listening is true while a startWake is open, starts counts the calls, and the tracks are counted until stopped', async () => {
    const wake = installWake();
    expect(wake.listening).toBe(false);
    expect(wake.starts).toBe(0);
    const pending = startWake({ modelUrl: '/m.json', onWake: () => undefined });
    expect(wake.starts).toBe(1);
    expect(wake.listening).toBe(false); // opening takes a moment, as the real one does
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;
    expect(wake.listening).toBe(true);
    expect(wake.liveTracks).toBe(1);
    if (!result.ok) throw new Error('expected a running wake');
    const clone = result.track.clone();
    expect(wake.liveTracks).toBe(2);
    expect(wake.tracks).toContain(clone);
    clone.stop();
    result.stop();
    result.stop();
    expect(wake.listening).toBe(false);
    expect(wake.liveTracks).toBe(0);
  });

  it('a stream given to startWake is left to its owner, as the real one does', async () => {
    const wake = installWake();
    const own = { stop: vi.fn(), readyState: 'live' };
    const stream = { getAudioTracks: () => [own], getTracks: () => [own] } as unknown as MediaStream;
    const pending = startWake({ model: {} as WakeModel, stream, onWake: () => undefined });
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;
    if (!result.ok) throw new Error('expected a running wake');
    expect(result.track).toBe(own);
    result.stop();
    expect(own.stop).not.toHaveBeenCalled();
    expect(wake.listening).toBe(false);
  });

  it("failWith('permission-denied') makes startWake fail with that kind until it is cleared", async () => {
    const wake = installWake();
    wake.failWith('permission-denied');
    const first = await opened();
    expect(first.result).toMatchObject({ ok: false, kind: 'permission-denied', message: expect.any(String) });
    expect(wake.listening).toBe(false);
    expect(wake.liveTracks).toBe(0);
    wake.failWith('not-supported');
    expect((await opened()).result).toMatchObject({ ok: false, kind: 'not-supported' });
    wake.failWith();
    expect((await opened()).result.ok).toBe(true);
    expect(wake.starts).toBe(3);
  });

  it('uninstall takes the handle away, so startWake is the real one again', async () => {
    const wake = installWake();
    wake.uninstall();
    expect(registry()?.wake).toBeUndefined();
    const result = await startWake({ modelUrl: '/m.json', onWake: () => undefined });
    expect(result).toMatchObject({ ok: false, kind: 'not-supported' });
  });
});

describe('wakeInitScript', () => {
  it('gives the same handle on a page', async () => {
    (0, eval)(wakeInitScript());
    const wake = registry()?.wake;
    if (!wake) throw new Error('no handle on the page');
    for (const key of ['say', 'failWith', 'uninstall', 'start'] as const) expect(typeof wake[key]).toBe('function');
    expect(wake.listening).toBe(false);
    const { result, onWake } = await opened();
    expect(result.ok).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(wake.listening).toBe(true);
    expect(wake.starts).toBe(1);
    wake.say();
    expect(onWake).toHaveBeenCalledTimes(1);
    wake.failWith('permission-denied');
    expect((await opened()).result).toMatchObject({ ok: false, kind: 'permission-denied' });
  });

  it('carries its options into the page', async () => {
    (0, eval)(wakeInitScript({ openMs: 500 }));
    const wake = registry()?.wake;
    if (!wake) throw new Error('no handle on the page');
    const pending = startWake({ modelUrl: '/m.json', onWake: () => undefined });
    await vi.advanceTimersByTimeAsync(499);
    expect(wake.listening).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).ok).toBe(true);
  });
});

// threeFingerTap: the fake finger gesture for an app's tests; the listeners are voice-kit/handsfree's own. Node's own EventTarget and
// Event stand in for the page (the fake needs only dispatchEvent and a global Event).
describe('threeFingerTap', () => {
  it('sends one touchstart per finger, then the touchends, each with the touches still down', () => {
    const target = new EventTarget();
    const seen: string[] = [];
    for (const type of ['touchstart', 'touchmove', 'touchend']) {
      target.addEventListener(type, (e) => {
        const t = e as Event & { touches: unknown[]; changedTouches: unknown[] };
        seen.push(`${e.type}:${t.touches.length}:${t.changedTouches.length}`);
      });
    }
    threeFingerTap(target);
    expect(seen).toEqual(['touchstart:1:1', 'touchstart:2:1', 'touchstart:3:1', 'touchend:2:1', 'touchend:1:1', 'touchend:0:1']);
  });

  it('is a tap to watchThreeFingerTaps, and a moved, a two-finger or a four-finger one is not', () => {
    const target = new EventTarget();
    const onTap = vi.fn();
    const stop = watchThreeFingerTaps(target, onTap);
    threeFingerTap(target);
    expect(onTap).toHaveBeenCalledTimes(1);
    threeFingerTap(target, { moveBy: 25 });
    threeFingerTap(target, { fingers: 4 });
    threeFingerTap(target, { fingers: 2 });
    expect(onTap).toHaveBeenCalledTimes(1);
    stop();
  });
});
