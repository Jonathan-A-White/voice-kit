// The real ports in one call (mw-rl10piw.2): the wake from startWake (here with the testing wake fake installed), the chimes,
// the document's visibility, and the app's listen passed in.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startListening } from 'voice-kit/composer';
import { browserWake, createBrowserHandsFree, documentVisibility } from 'voice-kit/handsfree';
import type { StartWakeResult, WakeModel, WakeOptions } from 'voice-kit/wake';
import { installMic, type MicFake } from 'voice-kit/testing/mic';
import { installWake, type WakeFake } from 'voice-kit/testing/handsfree';

/** A document that can be hidden and shown. */
function stubDocument() {
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as 'visible' | 'hidden',
    show(visible: boolean) {
      doc.visibilityState = visible ? 'visible' : 'hidden';
      doc.dispatchEvent(new Event('visibilitychange'));
    },
  });
  return doc;
}

let mic: MicFake;
let wake: WakeFake;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  vi.stubGlobal('window', globalThis);
  mic = installMic(globalThis);
  wake = installWake(globalThis);
});
afterEach(() => {
  wake.uninstall();
  mic.uninstall();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('documentVisibility', () => {
  it('reads document.hidden and calls back on visibilitychange until the returned function is called', () => {
    const doc = stubDocument();
    const port = documentVisibility(doc as unknown as Document);
    expect(port.isHidden()).toBe(false);
    const seen = vi.fn();
    const off = port.onChange(seen);
    doc.show(false);
    expect(port.isHidden()).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    doc.show(true);
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe('browserWake', () => {
  it('fetches the model once: later starts are given the model the first one loaded', async () => {
    const model = { kind: 'a model' } as unknown as WakeModel;
    const calls: WakeOptions[] = [];
    const start = vi.fn(async (options: WakeOptions): Promise<StartWakeResult> => {
      calls.push(options);
      const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
      return { ok: true, stop: vi.fn(), track, stream: {} as MediaStream, inputRate: 48000, model };
    });
    const port = browserWake({ modelUrl: '/m.json', startWake: start });
    const first = await port.start(() => undefined);
    const second = await port.start(() => undefined);
    expect(first.ok && second.ok).toBe(true);
    expect(calls[0]).toMatchObject({ modelUrl: '/m.json' });
    expect(calls[0].model).toBeUndefined();
    expect(calls[1].model).toBe(model);
  });

  it('says needs-touch, and does not start the wake, when the audio is not ready', async () => {
    const start = vi.fn();
    const port = browserWake({ modelUrl: '/m.json', ready: async () => false, startWake: start });
    expect(await port.start(() => undefined)).toMatchObject({ ok: false, kind: 'needs-touch' });
    expect(start).not.toHaveBeenCalled();
  });

  it('passes each wake on, and is the kit startWake by default (the fake answers it here)', async () => {
    const port = browserWake({ modelUrl: '/m.json' });
    const onWake = vi.fn();
    const started = port.start(onWake);
    await vi.advanceTimersByTimeAsync(200);
    const running = await started;
    expect(running.ok).toBe(true);
    expect(wake.listening).toBe(true);
    wake.say();
    expect(onWake).toHaveBeenCalledTimes(1);
    if (running.ok) running.stop();
    expect(wake.listening).toBe(false);
    expect(wake.liveTracks).toBe(0);
  });
});

describe('createBrowserHandsFree', () => {
  it('runs a whole exchange on the real ports: wake, chime, command, close; the hidden document stops it', async () => {
    const doc = stubDocument();
    const onCommand = vi.fn(async () => ({ followUp: false }));
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const hf = createBrowserHandsFree({ modelUrl: '/m.json', listen: startListening, document: doc as unknown as Document, onOpen, onCommand, onClose });
    void hf.start();
    await vi.advanceTimersByTimeAsync(200);
    expect(hf.state().name).toBe('waiting');
    wake.say();
    await vi.advanceTimersByTimeAsync(10000);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith('Please read me the first chapter', { followUp: false });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(hf.state().name).toBe('waiting');
    doc.show(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(hf.state()).toMatchObject({ name: 'off', hidden: true });
    expect(wake.liveTracks).toBe(0);
    doc.show(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(hf.state().name).toBe('waiting');
    hf.stop();
    await vi.advanceTimersByTimeAsync(100);
    expect(wake.liveTracks).toBe(0);
  });
});
