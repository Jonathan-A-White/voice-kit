// @vitest-environment jsdom
// VoiceRecorder's durationMs is a length of time, so it is measured on a clock the wall clock cannot move (mw-k4sekr.2).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceRecorder } from '../src/index.js';
import { FakeMediaRecorder, FakeMediaStream } from './support/fakes.js';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('MediaStream', FakeMediaStream);
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: () => Promise.resolve(new FakeMediaStream([{ stop: vi.fn() }])) },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true, writable: true });
});

describe('VoiceRecorder duration', () => {
  it('is the time recorded', async () => {
    const recorder = new VoiceRecorder();
    await recorder.start();
    await vi.advanceTimersByTimeAsync(4000);
    expect((await recorder.stop()).durationMs).toBe(4000);
  });

  it('stays positive and right when the wall clock steps back mid-recording', async () => {
    const recorder = new VoiceRecorder();
    await recorder.start();
    await vi.advanceTimersByTimeAsync(1500);
    vi.setSystemTime(Date.now() - 3_600_000); // the host's clock corrected an hour back
    await vi.advanceTimersByTimeAsync(2500);
    expect((await recorder.stop()).durationMs).toBe(4000);
  });
});
