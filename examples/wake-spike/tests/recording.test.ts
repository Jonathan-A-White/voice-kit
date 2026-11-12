// The recording of the tries (mw-rdpwdp1.11): the input audio kept as the page received it, the wake and miss marks, the
// WAV and the try log made from them, and how they are sent (the Web Share API with files, else a download). Network-free;
// no browser.
import { describe, expect, it, vi } from 'vitest';
import { createRecorder, MAX_RECORD_SECONDS } from '../src/recording.js';
import { sendFiles } from '../src/share.js';

const ramp = (n: number, from = 0) => Float32Array.from({ length: n }, (_, i) => (((from + i) % 100) - 50) / 100);

describe('the recorder', () => {
  it('keeps the samples it is given and makes a mono 16-bit WAV at the input rate', () => {
    const recorder = createRecorder(8000);
    recorder.add(Float32Array.of(0, 0.5, -0.5, 1, -1, 2));
    expect(recorder.seconds()).toBeCloseTo(6 / 8000, 9);
    const wav = recorder.toWav();
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const text = (at: number, n: number) => String.fromCharCode(...wav.subarray(at, at + n));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 8)).toBe('WAVEfmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(12);
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(wav.length).toBe(44 + 12);
    const pcm = [0, 2, 4, 6, 8, 10].map((i) => view.getInt16(44 + i, true));
    expect(pcm).toEqual([0, 16384, -16384, 32767, -32768, 32767]); // loud samples are clamped, not wrapped
  });

  it('keeps at most ten minutes, dropping the oldest audio, and says how much it dropped', () => {
    expect(MAX_RECORD_SECONDS).toBe(600);
    const recorder = createRecorder(100, 5); // 5 s cap at 100 Hz = 500 samples
    for (let i = 0; i < 9; i++) recorder.add(ramp(100, i * 100));
    expect(recorder.seconds()).toBe(9); // heard so far, in all
    expect(recorder.keptSeconds()).toBe(5);
    expect(recorder.droppedSeconds()).toBe(4);
    const wav = recorder.toWav();
    expect(wav.length).toBe(44 + 1000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getInt16(44, true)).toBe(Math.round(((400 % 100) - 50) / 100 * 32768)); // the first kept sample is sample 400
  });

  it('keeps each try as a wake or a miss with its time, and writes them in the try log', () => {
    const recorder = createRecorder(1000, 600, () => new Date('2026-11-12T10:00:00Z'));
    recorder.add(new Float32Array(2500));
    recorder.markWake({ time: 1.25, score: 0.987654 });
    recorder.markMiss();
    const log = recorder.tryLog({ label: 'Car mic', settings: { echoCancellation: true } });
    expect(log).toMatchObject({
      inputRate: 1000,
      listenedSeconds: 2.5,
      wavStartsAt: 0,
      wavSeconds: 2.5,
      input: { label: 'Car mic', settings: { echoCancellation: true } },
      wakes: 1,
      misses: 1,
    });
    expect(log.tries).toEqual([
      { kind: 'wake', at: 1.25, score: 0.9877, clock: '2026-11-12T10:00:00.000Z' },
      { kind: 'miss', at: 2.5, clock: '2026-11-12T10:00:00.000Z' },
    ]);
  });
});

describe('sending', () => {
  const files = () => [new File(['x'], 'tries.wav', { type: 'audio/wav' }), new File(['{}'], 'tries.json', { type: 'application/json' })];

  it('shares the files with the Web Share API where the phone can', async () => {
    const share = vi.fn(async () => undefined);
    const download = vi.fn();
    const sent = files();
    const how = await sendFiles(sent, { canShare: () => true, share }, download);
    expect(how).toBe('shared');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: sent }));
    expect(download).not.toHaveBeenCalled();
  });

  it('downloads them when the browser cannot share files', async () => {
    const download = vi.fn();
    const sent = files();
    expect(await sendFiles(sent, {}, download)).toBe('downloaded');
    expect(await sendFiles(sent, { canShare: () => false, share: vi.fn() }, download)).toBe('downloaded');
    expect(download).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenCalledWith(sent);
  });

  it('says it was cancelled, and sends nothing, when he closes the share sheet', async () => {
    const share = vi.fn(async () => {
      throw new DOMException('closed', 'AbortError');
    });
    const download = vi.fn();
    expect(await sendFiles(files(), { canShare: () => true, share }, download)).toBe('cancelled');
    expect(download).not.toHaveBeenCalled();
  });

  it('falls back to a download when sharing fails some other way', async () => {
    const share = vi.fn(async () => {
      throw new DOMException('no', 'NotAllowedError');
    });
    const download = vi.fn();
    expect(await sendFiles(files(), { canShare: () => true, share }, download)).toBe('downloaded');
    expect(download).toHaveBeenCalledTimes(1);
  });
});
