// @voice-kit/wake (mw-rl10piw.1): the wake word as a package. Network-free and browser-free: the detector runs in Node on the
// committed model, and startWake runs against counted stubs of the browser's audio parts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import * as wake from 'voice-kit/wake';
import type { Capture, CaptureHandlers, Detector, DetectorStats, StartWakeResult, Wake, WakeFailure, WakeModel, WakeOptions } from 'voice-kit/wake';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const MODEL = here('../../../examples/wake-spike/public/models/hey-lampas.json');
const FIXTURE = here('../../../examples/wake-spike/tests/fixtures/hey-lampas-espeak.wav');
const ENGLISH = here('../../testing/clips/english.wav');

/** The samples of a 16 kHz, 16-bit mono PCM WAV file as floats in [-1, 1]. */
function readWav(path: string): Float32Array {
  const buf = readFileSync(path);
  let at = 12;
  while (at + 8 <= buf.length) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === 'data') {
      const out = new Float32Array(size >> 1);
      for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(at + 8 + i * 2) / 32768;
      return out;
    }
    at += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${path}`);
}

const padded = (clip: Float32Array, before: number, after: number): Float32Array => {
  const out = new Float32Array(Math.round((before + after) * 16000) + clip.length);
  out.set(clip, Math.round(before * 16000));
  return out;
};

const model = JSON.parse(readFileSync(MODEL, 'utf8')) as WakeModel;

function wakesOf(samples: Float32Array): Wake[] {
  const detector: Detector = wake.createDetector(wake.loadModel(model));
  const found: Wake[] = [];
  for (let at = 0; at < samples.length; at += 4000) found.push(...detector.push(samples.subarray(at, at + 4000)));
  return found;
}

describe("'voice-kit/wake' exports", () => {
  it('has the model reader, the detector, the resampler, the capture and startWake', () => {
    for (const name of ['loadModel', 'createDetector', 'createResampler', 'startCapture', 'startWake']) {
      expect(typeof (wake as Record<string, unknown>)[name], name).toBe('function');
    }
    // the types are there to import (checked by tsc; this keeps the imports used)
    const types: [Capture?, CaptureHandlers?, DetectorStats?, StartWakeResult?, WakeFailure?, WakeOptions?] = [];
    expect(types).toHaveLength(0);
  });

  it('hears the fixture saying exactly once and the English clip not at all', () => {
    expect(wakesOf(padded(readWav(FIXTURE), 1, 2))).toHaveLength(1);
    expect(wakesOf(padded(readWav(ENGLISH), 1, 1))).toHaveLength(0);
  });

  it('keeps the detector free of imports, so a worker and Node run it as it is', () => {
    const source = readFileSync(here('../src/detector.ts'), 'utf8');
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/^\s*export\s[^\n]*\sfrom\s/m);
  });

  it('has no bundler-only import and no import.meta.url in the package source', () => {
    for (const file of ['detector.ts', 'capture.ts', 'worker.ts', 'workletSource.ts', 'workerSource.ts', 'startWake.ts', 'index.ts']) {
      const source = readFileSync(here(`../src/${file}`), 'utf8');
      expect(source, file).not.toMatch(/\?raw|import\.meta\.url/);
    }
  });
});

describe('the embedded worker source', () => {
  it('is what scripts/embed.mjs makes of detector.ts and worker.ts, so the two cannot drift', async () => {
    const { workerText } = (await import(/* @vite-ignore */ new URL('../scripts/embed.mjs', import.meta.url).href)) as { workerText(): string };
    const { workerSource } = await import('../src/workerSource.js');
    expect(workerSource).toBe(workerText());
    expect(workerSource).toContain('createDetector');
    expect(workerSource).not.toMatch(/^import /m);
  });
});

/** Stubs of the browser's audio parts, counted. */
function install(options: { worklet?: boolean; refuse?: string } = {}) {
  const counts = { workers: 0, workersTerminated: 0, contexts: 0, contextsClosed: 0, tracksStopped: 0, getUserMedia: 0 };
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const set = (name: string, value: unknown, target: object = g) => {
    if (target === g) saved.set(name, Object.getOwnPropertyDescriptor(g, name));
    Object.defineProperty(target, name, { value, configurable: true, writable: true });
  };
  const track = { kind: 'audio', stop: () => void counts.tracksStopped++ };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: { message: string }) => void) | null = null;
    constructor() {
      counts.workers++;
    }
    postMessage(message: { type: string }) {
      if (message.type === 'init') queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', parameters: 1 } }));
    }
    terminate() {
      counts.workersTerminated++;
    }
  }
  class FakeContext {
    sampleRate = 48000;
    destination = {};
    audioWorklet = { addModule: async () => undefined };
    constructor() {
      counts.contexts++;
    }
    createGain() {
      const node = { gain: { value: 1 }, connect: (to: unknown) => to };
      return node;
    }
    createMediaStreamSource() {
      return { connect: (to: unknown) => to };
    }
    async resume() {}
    async close() {
      counts.contextsClosed++;
    }
  }
  class FakeNode {
    port = { onmessage: null as unknown };
    connect(to: unknown) {
      return to;
    }
  }
  if (options.worklet !== false) {
    set('AudioContext', FakeContext);
    set('AudioWorkletNode', FakeNode);
  } else {
    set('AudioContext', undefined);
    set('AudioWorkletNode', undefined);
  }
  set('Worker', FakeWorker);
  set(
    'navigator',
    {
      mediaDevices: {
        getUserMedia: async () => {
          counts.getUserMedia++;
          if (options.refuse) throw Object.assign(new Error('refused'), { name: options.refuse });
          return stream;
        },
      },
    },
  );
  return {
    counts,
    stream,
    restore() {
      for (const [name, descriptor] of saved) {
        if (descriptor) Object.defineProperty(g, name, descriptor);
        else delete g[name];
      }
    },
  };
}

describe('startWake', () => {
  let stubs: ReturnType<typeof install> | undefined;
  afterEach(() => {
    stubs?.restore();
    stubs = undefined;
  });

  it("resolves a 'not-supported' failure when there is no AudioWorklet, and opens nothing", async () => {
    stubs = install({ worklet: false });
    const result = await wake.startWake({ model, onWake: () => undefined });
    expect(result).toMatchObject({ ok: false, kind: 'not-supported' });
    expect(stubs.counts.getUserMedia).toBe(0);
    expect(stubs.counts.workers).toBe(0);
  });

  it("resolves a 'not-supported' failure when there is no microphone API to open and no stream was given", async () => {
    stubs = install();
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
    expect(await wake.startWake({ model, onWake: () => undefined })).toMatchObject({ ok: false, kind: 'not-supported' });
  });

  it("resolves a 'permission-denied' failure when getUserMedia is refused, and starts no worker", async () => {
    stubs = install({ refuse: 'NotAllowedError' });
    const result = await wake.startWake({ model, onWake: () => undefined });
    expect(result).toMatchObject({ ok: false, kind: 'permission-denied' });
    expect(stubs.counts.getUserMedia).toBe(1);
    expect(stubs.counts.workers).toBe(0);
  });

  it("resolves a 'no-microphone' failure when there is no input, and 'other' for anything else", async () => {
    stubs = install({ refuse: 'NotFoundError' });
    expect(await wake.startWake({ model, onWake: () => undefined })).toMatchObject({ ok: false, kind: 'no-microphone' });
    stubs.restore();
    stubs = install({ refuse: 'AbortError' });
    expect(await wake.startWake({ model, onWake: () => undefined })).toMatchObject({ ok: false, kind: 'other' });
  });

  it("resolves 'other' when the model cannot be fetched", async () => {
    stubs = install();
    const result = await wake.startWake({ modelUrl: 'https://app.test/none.json', onWake: () => undefined, fetch: async () => ({ ok: false, status: 404 }) as Response });
    expect(result).toMatchObject({ ok: false, kind: 'other' });
    expect(stubs.counts.getUserMedia).toBe(0);
  });

  it('opens the default microphone, starts one worker, and stop() ends the track, the worker and the audio context', async () => {
    stubs = install();
    const result = await wake.startWake({ model, onWake: () => undefined });
    if (!result.ok) throw new Error(`failed: ${result.kind} ${result.message}`);
    expect(result.track).toBe(stubs.stream.getAudioTracks()[0]);
    expect(stubs.counts).toMatchObject({ getUserMedia: 1, workers: 1, contexts: 1, tracksStopped: 0, workersTerminated: 0, contextsClosed: 0 });
    result.stop();
    expect(stubs.counts).toMatchObject({ tracksStopped: 1, workersTerminated: 1, contextsClosed: 1 });
    result.stop(); // twice is the same as once
    expect(stubs.counts).toMatchObject({ tracksStopped: 1, workersTerminated: 1, contextsClosed: 1 });
  });

  it("loads the model from modelUrl, and leaves a stream it was given to its owner", async () => {
    stubs = install();
    const asked: string[] = [];
    const result = await wake.startWake({
      modelUrl: 'https://app.test/hey-lampas.json',
      stream: stubs.stream as unknown as MediaStream,
      onWake: () => undefined,
      fetch: async (url) => (asked.push(String(url)), new Response(JSON.stringify(model))),
    });
    expect(asked).toEqual(['https://app.test/hey-lampas.json']);
    if (!result.ok) throw new Error(result.message);
    expect(stubs.counts.getUserMedia).toBe(0);
    result.stop();
    expect(stubs.counts.tracksStopped).toBe(0);
    expect(stubs.counts.workersTerminated).toBe(1);
  });
});
