// @vitest-environment jsdom
// How audio becomes text is the app's choice: the browser's speech recogniser (as Postern does today) or a
// transcribe function the app passes, which gets the hold's recording when he lets go.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browserSpeech, transcribeRecording, type Recording } from '../src/index.js';
import { FakeMediaRecorder, FakeMediaStream, FakeRecognizer, installRecognizer } from './support/fakes.js';

const getUserMedia = vi.fn(() => Promise.resolve(new FakeMediaStream([{ stop: vi.fn() }])));

beforeEach(() => {
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('MediaStream', FakeMediaStream);
  getUserMedia.mockClear();
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true, writable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true, writable: true });
});

describe('browserSpeech', () => {
  it("is the browser's recogniser: supported only where there is one", () => {
    expect(browserSpeech.supported()).toBe(false);
    installRecognizer();
    expect(browserSpeech.supported()).toBe(true);
    const started = browserSpeech.start({});
    expect(started.ok).toBe(true);
    expect(FakeRecognizer.instances).toHaveLength(1);
  });
});

describe('transcribeRecording', () => {
  it('records while he holds, says the mic is open, and hands the recording to the transcribe function on release', async () => {
    const transcribe = vi.fn(async (recording: Recording) => `heard ${recording.blob.size} bytes of ${recording.mime}`);
    const transcriber = transcribeRecording(transcribe);
    expect(transcriber.supported()).toBe(true);
    const onStart = vi.fn();
    const onInterim = vi.fn();
    const started = transcriber.start({ onStart, onInterim });
    if (!started.ok) throw new Error('expected it to start');
    await vi.waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    const result = await started.session.stop();
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true, text: 'heard 3 bytes of audio/webm', mode: 'cloud' });
    expect(onInterim).toHaveBeenCalledWith('heard 3 bytes of audio/webm');
  });

  it('settles with an error, never a throw, when the transcribe function fails', async () => {
    const transcriber = transcribeRecording(async () => {
      throw new Error('the server is down');
    });
    const started = transcriber.start({});
    if (!started.ok) throw new Error('expected it to start');
    const result = await started.session.stop();
    expect(result).toEqual({ ok: false, text: '', error: { kind: 'other', message: 'the server is down' } });
  });

  it('reports a refused microphone through onError', async () => {
    getUserMedia.mockImplementationOnce(() => Promise.reject(new Error('NotAllowedError')));
    const onError = vi.fn();
    const started = transcribeRecording(async () => 'never').start({ onError, appName: 'Lampas' });
    if (!started.ok) throw new Error('expected it to start');
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0][0]).toMatchObject({ kind: 'permission-denied' });
    expect(onError.mock.calls[0][0].message).toContain('Lampas');
    const result = await started.session.stop();
    expect(result.ok).toBe(false);
  });

  it('records nothing more once aborted', async () => {
    const transcribe = vi.fn(async () => 'never');
    const started = transcribeRecording(transcribe).start({});
    if (!started.ok) throw new Error('expected it to start');
    started.session.abort();
    expect(await started.session.stop()).toEqual({ ok: true, text: '', mode: 'cloud' });
    expect(transcribe).not.toHaveBeenCalled();
  });
});
