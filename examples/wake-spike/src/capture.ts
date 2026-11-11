// Feeds an opened microphone stream to the wake detector. An AudioWorklet (capture-worklet.js, bundled as text and loaded
// from a blob: URL, so it needs no file of its own on the server) takes the samples
// off the audio thread, the page relays them to a Web Worker (worker.ts) that resamples them to 16 kHz and runs the
// detector. The worklet is joined to a silent gain node and that to the output: a worklet that nothing pulls is not run
// by every browser. Nothing audible is added.
import workletSource from './capture-worklet.js?raw';
import type { DetectorStats, Wake, WakeModel } from './detector.js';
import type { FromWorker, ToWorker } from './worker.js';

export interface CaptureHandlers {
  onWake(wake: Wake): void;
  onStats(stats: DetectorStats): void;
  onError(message: string): void;
}

export interface Capture {
  /** The rate the browser captures at, before the worker brings it to 16 kHz. */
  inputRate: number;
  stop(): void;
}

/** Starts feeding `stream` to the detector. Resolves when the worker has loaded the model. Throws when a part is missing. */
export async function startCapture(stream: MediaStream, model: WakeModel, handlers: CaptureHandlers): Promise<Capture> {
  const context = new AudioContext();
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const send = (message: ToWorker, transfer: Transferable[] = []) => worker.postMessage(message, transfer);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    worker.terminate();
    void context.close();
  };
  try {
    const ready = new Promise<void>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<FromWorker>) => {
        const message = event.data;
        if (message.type === 'ready') resolve();
        else if (message.type === 'wake') handlers.onWake(message.wake);
        else if (message.type === 'stats') handlers.onStats(message.stats);
        else if (!stopped) {
          handlers.onError(message.message);
          reject(new Error(message.message));
        }
      };
      worker.onerror = (event) => reject(new Error(event.message || 'the detector worker failed to start'));
    });
    send({ type: 'init', model, inputRate: context.sampleRate });
    const moduleUrl = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));
    try {
      await context.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    const tap = new AudioWorkletNode(context, 'wake-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    tap.port.onmessage = (event: MessageEvent<Float32Array>) => send({ type: 'audio', samples: event.data }, [event.data.buffer]);
    const silent = context.createGain();
    silent.gain.value = 0;
    context.createMediaStreamSource(stream).connect(tap);
    tap.connect(silent).connect(context.destination);
    await context.resume();
    await ready;
  } catch (err) {
    stop();
    throw err;
  }
  return { inputRate: context.sampleRate, stop };
}
