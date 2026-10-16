import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clips, installMic, micInitScript } from '../src/mic.js';
import type { FakeStream, MicFake, MicOptions } from '../src/mic.js';

let mic: MicFake;
let win: Record<string, unknown>;

function install(options?: MicOptions) {
  mic?.uninstall();
  mic = installMic(win, options);
}
beforeEach(() => {
  vi.useFakeTimers();
  win = {};
  install();
});
afterEach(() => {
  mic.uninstall();
  vi.useRealTimers();
});

const nav = () => (win.navigator as { mediaDevices: { getUserMedia(c: unknown): Promise<FakeStream> } }).mediaDevices;
const WORDS = clips.english.transcript.split(' ');

/** Opens the mic and returns the stream, with the time it took to grant. */
async function open(): Promise<FakeStream> {
  const p = nav().getUserMedia({ audio: true });
  await vi.advanceTimersByTimeAsync(100);
  return p;
}

const energy = (bytes: Uint8Array) => bytes.reduce((n, b) => n + b, 0);

describe('the clips', () => {
  it('are a Greek one and an English one, each a few seconds of PCM WAV with its transcript', () => {
    expect(clips.english.lang).toBe('en-US');
    expect(clips.greek.lang).toBe('el-GR');
    expect(clips.greek.transcript).toMatch(/[α-ω]/);
    for (const clip of [clips.english, clips.greek]) {
      install({ clip });
      expect(mic.clip.sampleRate).toBe(16000);
      expect(mic.clip.durationMs).toBeGreaterThan(1000);
      expect(mic.clip.durationMs).toBeLessThan(4000);
    }
  });
});

describe('getUserMedia', () => {
  it('resolves with a live audio stream after the grant takes its 100 ms', async () => {
    let stream: FakeStream | undefined;
    void nav().getUserMedia({ audio: true }).then((s) => (stream = s));
    await vi.advanceTimersByTimeAsync(99);
    expect(stream).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(stream?.active).toBe(true);
    expect(stream?.getAudioTracks()).toHaveLength(1);
    expect(stream?.getAudioTracks()[0]).toMatchObject({ kind: 'audio', readyState: 'live', enabled: true });
    expect(stream?.getVideoTracks()).toEqual([]);
  });

  it('stopping every track ends the stream', async () => {
    const stream = await open();
    stream.getTracks().forEach((t) => t.stop());
    expect(stream.active).toBe(false);
    expect(stream.getAudioTracks()[0].readyState).toBe('ended');
  });

  it('rejects a request that asks for no audio', async () => {
    const p = nav().getUserMedia({ video: true });
    const caught = p.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(200);
    expect(((await caught) as Error).name).toBe('NotFoundError');
  });

  it('lists a default audio input once granted', async () => {
    const devices = (win.navigator as { mediaDevices: { enumerateDevices(): Promise<{ kind: string }[]> } }).mediaDevices;
    expect((await devices.enumerateDevices()).map((d) => d.kind)).toEqual(['audioinput']);
  });
});

describe('the stream plays the clip in real time', () => {
  it('its position moves with the clock and it plays until the clip ends', async () => {
    const stream = await open();
    expect(stream.positionMs()).toBe(0);
    expect(stream.playing).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(stream.positionMs()).toBe(500);
    await vi.advanceTimersByTimeAsync(mic.clip.durationMs - 500 - 1);
    expect(stream.playing).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(stream.playing).toBe(false);
  });

  it("hands over the clip's samples for a stretch of time, 16 kHz 16-bit, and silence once it is over", async () => {
    const stream = await open();
    const first = stream.read(0, 500);
    expect(first.length).toBe(500 * 16 * 2);
    expect(energy(first)).toBeGreaterThan(0);
    expect(energy(stream.read(mic.clip.durationMs + 10, mic.clip.durationMs + 60))).toBe(0);
    expect(stream.read(0, 250).length + stream.read(250, 500).length).toBe(first.length);
  });
});

describe('MediaRecorder', () => {
  type Rec = InstanceType<MicFake['MediaRecorder']>;
  function record(stream: FakeStream, timeslice?: number) {
    const rec: Rec = new mic.MediaRecorder(stream);
    const events: string[] = [];
    const chunks: Blob[] = [];
    rec.onstart = () => events.push(`start@${Date.now() - t0}`);
    rec.ondataavailable = (e) => {
      chunks.push(e.data);
      events.push(`data@${Date.now() - t0}`);
    };
    rec.onstop = () => events.push(`stop@${Date.now() - t0}`);
    const t0 = Date.now();
    rec.start(timeslice);
    return { rec, events, chunks };
  }
  const bytes = async (chunks: Blob[]) => new Uint8Array(await new Blob(chunks).arrayBuffer());

  it('is recording after start(); with a timeslice it hands over a chunk every slice as it records', async () => {
    const stream = await open();
    const { rec, events } = record(stream, 250);
    expect(rec.state).toBe('recording');
    await vi.advanceTimersByTimeAsync(800);
    expect(events).toEqual(['start@0', 'data@250', 'data@500', 'data@750']);
  });

  it('on stop() hands over what is left, then stops; the chunks together are what the stream said', async () => {
    const stream = await open();
    const { rec, events, chunks } = record(stream, 250);
    await vi.advanceTimersByTimeAsync(600);
    rec.stop();
    expect(rec.state).toBe('inactive');
    await vi.advanceTimersByTimeAsync(10);
    expect(events.slice(-2)).toEqual(['data@600', 'stop@600']);
    expect(await bytes(chunks)).toEqual(stream.read(0, 600));
  });

  it('with no timeslice gives the whole in one piece on stop()', async () => {
    const stream = await open();
    const { rec, events, chunks } = record(stream);
    await vi.advanceTimersByTimeAsync(700);
    expect(events).toEqual(['start@0']);
    rec.stop();
    await vi.advanceTimersByTimeAsync(10);
    expect(events).toEqual(['start@0', 'data@700', 'stop@700']);
    expect(chunks[0].type).toBe('audio/webm;codecs=opus');
    expect(chunks[0].size).toBe(700 * 16 * 2);
  });

  it('pause() holds the data and resume() carries on', async () => {
    const stream = await open();
    const { rec, chunks } = record(stream, 100);
    await vi.advanceTimersByTimeAsync(200);
    rec.pause();
    expect(rec.state).toBe('paused');
    await vi.advanceTimersByTimeAsync(1000);
    rec.resume();
    await vi.advanceTimersByTimeAsync(100);
    rec.stop();
    await vi.advanceTimersByTimeAsync(10);
    expect((await bytes(chunks)).length).toBe(300 * 16 * 2);
  });

  it('knows which types it can make, and refuses to start twice', async () => {
    expect(mic.MediaRecorder.isTypeSupported('audio/webm;codecs=opus')).toBe(true);
    expect(mic.MediaRecorder.isTypeSupported('audio/mp4')).toBe(false);
    const { rec } = record(await open());
    expect(() => rec.start()).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
  });
});

describe('MediaRecorder with recorderType audio/wav', () => {
  type Rec = InstanceType<MicFake['MediaRecorder']>;
  const text = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));
  async function recordFor(holdMs: number, timeslice?: number) {
    install({ recorderType: 'audio/wav' });
    const stream = await open();
    const rec: Rec = new mic.MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.start(timeslice);
    await vi.advanceTimersByTimeAsync(holdMs);
    rec.stop();
    await vi.advanceTimersByTimeAsync(10);
    return { stream, chunks, bytes: new Uint8Array(await new Blob(chunks).arrayBuffer()) };
  }

  it('hands over a WAV file Chromium can decode: labelled audio/wav, RIFF/WAVE, the stream sample rate, the length of the hold', async () => {
    const { stream, chunks, bytes } = await recordFor(700);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('audio/wav');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(text(bytes, 0)).toBe('RIFF');
    expect(text(bytes, 8)).toBe('WAVE');
    expect(text(bytes, 12)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(bytes, 36)).toBe('data');
    const dataBytes = 700 * 16 * 2;
    expect(view.getUint32(40, true)).toBe(dataBytes);
    expect(view.getUint32(4, true)).toBe(bytes.length - 8);
    expect(bytes.length).toBe(44 + dataBytes);
    expect(bytes.subarray(44)).toEqual(stream.read(0, 700));
  });

  it('keeps one header when the recording comes in slices: the chunks together are one WAV of the whole hold', async () => {
    const { stream, bytes } = await recordFor(600, 250);
    expect(text(bytes, 0)).toBe('RIFF');
    expect(text(bytes, 8)).toBe('WAVE');
    expect(bytes.length).toBe(44 + 600 * 16 * 2);
    expect(bytes.subarray(44)).toEqual(stream.read(0, 600));
  });

  it('says it supports audio/wav, which the default recorder (Android Chrome) does not', () => {
    expect(mic.MediaRecorder.isTypeSupported('audio/wav')).toBe(false);
    install({ recorderType: 'audio/wav' });
    expect(mic.MediaRecorder.isTypeSupported('audio/wav')).toBe(true);
  });
});

describe('SpeechRecognition', () => {
  type Rec = InstanceType<MicFake['SpeechRecognition']>;
  /** Starts a recogniser and writes what it does, each with the ms since start(), into `log`. */
  function listen(setup: (r: Rec) => void = () => {}) {
    const r: Rec = new mic.SpeechRecognition();
    const log: string[] = [];
    const t0 = Date.now();
    const at = () => Date.now() - t0;
    for (const name of ['start', 'audiostart', 'soundstart', 'speechstart', 'speechend', 'soundend', 'audioend', 'nomatch', 'end'] as const) {
      r.addEventListener(name, () => log.push(`${name}@${at()}`));
    }
    r.onresult = (e) => {
      const result = e.results[e.results.length - 1];
      log.push(`${result.isFinal ? 'final' : 'interim'}:${result[0].transcript}@${at()}`);
    };
    r.onerror = (e) => log.push(`error:${e.error}@${at()}`);
    setup(r);
    r.start();
    return { r, log };
  }
  const kinds = (log: string[]) => log.map((l) => l.replace(/:.*@/, '@').split('@')[0]);
  const timeOf = (log: string[], prefix: string) => Number(log.find((l) => l.startsWith(prefix))?.split('@')[1]);

  it('is the same constructor under the webkit name', () => {
    expect(win.webkitSpeechRecognition).toBe(win.SpeechRecognition);
    expect(win.SpeechRecognition).toBe(mic.SpeechRecognition);
  });

  it('opens after 200 to 400 ms, not at once', async () => {
    const { log } = listen();
    await vi.advanceTimersByTimeAsync(199);
    expect(log).toEqual([]);
    await vi.advanceTimersByTimeAsync(201);
    const opened = timeOf(log, 'start');
    expect(opened).toBeGreaterThanOrEqual(200);
    expect(opened).toBeLessThanOrEqual(400);
    expect(kinds(log).slice(0, 2)).toEqual(['start', 'audiostart']);
  });

  it('sends interim results word by word as the clip plays, then one final at its end', async () => {
    const { log } = listen((r) => (r.interimResults = true));
    await vi.advanceTimersByTimeAsync(10_000);
    const results = log.filter((l) => /^(interim|final):/.test(l));
    expect(results.map((l) => l.replace(/@.*/, ''))).toEqual([
      ...WORDS.slice(0, -1).map((_, i) => `interim:${WORDS.slice(0, i + 1).join(' ')}`),
      `final:${clips.english.transcript}`,
    ]);
    const opened = timeOf(log, 'start');
    const times = results.map((l) => Number(l.split('@')[1]));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[0]).toBeGreaterThan(opened);
    expect(times[times.length - 1]).toBe(opened + mic.clip.durationMs);
  });

  it('sends only the final result when interim results are not asked for', async () => {
    const { log } = listen();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(log.filter((l) => /^(interim|final):/.test(l))).toHaveLength(1);
    expect(log.some((l) => l.startsWith('final:'))).toBe(true);
  });

  it('ends 1.5 s after the clip ends, and not before', async () => {
    const { log } = listen();
    await vi.advanceTimersByTimeAsync(10_000);
    const opened = timeOf(log, 'start');
    expect(timeOf(log, 'end')).toBe(opened + mic.clip.durationMs + 1500);
    expect(kinds(log).at(-1)).toBe('end');
    expect(kinds(log).indexOf('audioend')).toBeLessThan(kinds(log).indexOf('end'));
  });

  it('the silence is an option', async () => {
    install({ silenceMs: 400 });
    const { log } = listen();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(timeOf(log, 'end')).toBe(timeOf(log, 'start') + mic.clip.durationMs + 400);
  });

  it('a silent input sends nothing for 3 s, then the clip', async () => {
    install({ silent: true });
    const { log } = listen((r) => (r.interimResults = true));
    await vi.advanceTimersByTimeAsync(300 + 2999);
    expect(log.filter((l) => /^(interim|final|speechstart|soundstart):/.test(l) || /^(speechstart|soundstart)@/.test(l))).toEqual([]);
    await vi.advanceTimersByTimeAsync(10_000);
    const opened = timeOf(log, 'start');
    expect(timeOf(log, 'interim:')).toBeGreaterThan(opened + 3000);
    expect(log.some((l) => l.startsWith('final:'))).toBe(true);
  });

  it('a silent input that never speaks ends in no-speech', async () => {
    install({ silent: Infinity });
    const { log } = listen();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(kinds(log)).toEqual(['start', 'audiostart', 'audioend', 'error', 'end']);
    expect(log.find((l) => l.startsWith('error'))).toMatch(/^error:no-speech@/);
  });

  it('a silent stream reads zeros for its first 3 s, then the clip', async () => {
    install({ silent: true });
    const stream = await open();
    expect(energy(stream.read(0, 3000))).toBe(0);
    expect(energy(stream.read(3000, 3500))).toBeGreaterThan(0);
  });

  it("denied: the recogniser errors 'not-allowed' and ends", async () => {
    install({ denied: true });
    const { log } = listen();
    await vi.advanceTimersByTimeAsync(2000);
    expect(kinds(log)).toEqual(['error', 'end']);
    expect(log[0]).toMatch(/^error:not-allowed@/);
  });

  it('stop() delivers the words heard so far as final, then ends', async () => {
    const { r, log } = listen((rec) => (rec.interimResults = true));
    await vi.advanceTimersByTimeAsync(300 + 900);
    const heard = log.filter((l) => l.startsWith('interim:')).length;
    expect(heard).toBeGreaterThan(0);
    r.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(log.filter((l) => l.startsWith('final:'))).toEqual([expect.stringMatching(new RegExp(`^final:${WORDS.slice(0, heard).join(' ')}@`))]);
    expect(kinds(log).at(-1)).toBe('end');
  });

  it("abort() ends with error 'aborted' and no result", async () => {
    const { r, log } = listen();
    await vi.advanceTimersByTimeAsync(600);
    r.abort();
    await vi.advanceTimersByTimeAsync(5000);
    expect(kinds(log).slice(-2)).toEqual(['error', 'end']);
    expect(log.some((l) => /^(interim|final):/.test(l))).toBe(false);
    expect(log.find((l) => l.startsWith('error'))).toMatch(/^error:aborted/);
  });

  it('start() twice is an InvalidStateError', () => {
    const { r } = listen();
    expect(() => r.start()).toThrow(expect.objectContaining({ name: 'InvalidStateError' }));
  });

  it('can be started again once it has ended', async () => {
    const { r } = listen();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(() => r.start()).not.toThrow();
  });

  it('start(track) on an ended track errors audio-capture', async () => {
    const stream = await open();
    const track = stream.getAudioTracks()[0];
    track.stop();
    const r: Rec = new mic.SpeechRecognition();
    const errors: string[] = [];
    r.onerror = (e) => errors.push(e.error ?? '');
    r.start(track);
    await vi.advanceTimersByTimeAsync(1000);
    expect(errors).toEqual(['audio-capture']);
  });

  it('hears the Greek clip as Greek words', async () => {
    install({ clip: clips.greek });
    const { log } = listen();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(log.find((l) => l.startsWith('final:'))).toContain(clips.greek.transcript);
  });
});

describe('a denied permission', () => {
  it('rejects getUserMedia with NotAllowedError', async () => {
    install({ denied: true });
    const caught = nav()
      .getUserMedia({ audio: true })
      .catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(200);
    const err = (await caught) as Error;
    expect(err.name).toBe('NotAllowedError');
    expect(err).toBeInstanceOf(Error);
  });

  it('can be flipped on the handle while installed', async () => {
    mic.options.denied = true;
    const caught = nav()
      .getUserMedia({ audio: true })
      .catch((e: Error) => e.name);
    await vi.advanceTimersByTimeAsync(200);
    expect(await caught).toBe('NotAllowedError');
  });
});

describe('installing', () => {
  it('puts the fakes on the target and uninstall takes them off', () => {
    expect(win.MediaRecorder).toBe(mic.MediaRecorder);
    mic.uninstall();
    expect('MediaRecorder' in win).toBe(false);
    expect('SpeechRecognition' in win).toBe(false);
    expect('webkitSpeechRecognition' in win).toBe(false);
    expect('navigator' in win).toBe(false);
    install();
  });

  it('keeps a navigator the target already has, and gives it back', () => {
    mic.uninstall();
    const navigator: Record<string, unknown> = { userAgent: 'x' };
    win = { navigator };
    install();
    expect(navigator.mediaDevices).toBeDefined();
    mic.uninstall();
    expect('mediaDevices' in navigator).toBe(false);
    expect(win.navigator).toBe(navigator);
    install();
  });
});

describe('the init script for Playwright', () => {
  it('installs the same fakes on a page, from a string, with the clip inside it', async () => {
    mic.uninstall();
    const g = globalThis as Record<string, unknown>;
    const had = Object.getOwnPropertyDescriptor(g, 'navigator');
    (0, eval)(micInitScript({ clip: clips.greek }));
    const handle = (g.__bsvKitTesting as { mic: MicFake }).mic;
    expect(handle.clip.durationMs).toBeGreaterThan(1000);
    const Recognition = g.webkitSpeechRecognition as MicFake['SpeechRecognition'];
    const r = new Recognition();
    const finals: string[] = [];
    r.onresult = (e) => finals.push(e.results[0][0].transcript);
    r.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(finals).toEqual([clips.greek.transcript]);
    handle.uninstall();
    expect(Object.getOwnPropertyDescriptor(g, 'navigator')).toEqual(had);
    install();
  });
});
