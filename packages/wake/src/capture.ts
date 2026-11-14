// Feeds an opened microphone stream to the wake detector. An AudioWorklet (workletSource.ts, as text, loaded from a blob: URL,
// so it needs no file of its own on the server) takes the samples off the audio thread, the page relays them to a Web
// Worker (workerSource.ts, as text, started from a blob: URL) that resamples them to 16 kHz and runs the detector. No bundler is
// needed; a site with a Content-Security-Policy must allow blob: for worker-src and script-src (the worklet is a module too).
// The worklet is joined to a silent gain node and that to the output: a worklet that nothing pulls is not run by every
// browser. Nothing audible is added.
import type { DetectorStats, Wake, WakeModel } from './detector.js';
import type { FromWorker, ToWorker } from './worker.js';
import { workerSource } from './workerSource.js';
import { workletSource } from './workletSource.js';

export interface CaptureHandlers {
  onWake(wake: Wake): void;
  onStats(stats: DetectorStats): void;
  onError(message: string): void;
  /** Each batch of input samples as the page received them, before the resampling; it is called before the batch goes on to the worker, so copy what you keep. */
  onInput?(samples: Float32Array, inputRate: number): void;
}

export interface Capture {
  /** The rate the browser captures at, before the worker brings it to 16 kHz. */
  inputRate: number;
  /** Ends the worker and the audio context. It does not end the stream's tracks: they are the caller's. */
  stop(): void;
}

const blobUrl = (text: string): string => URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));

/** Starts feeding `stream` to the detector. Resolves when the worker has loaded the model. Throws when a part is missing. */
export async function startCapture(stream: MediaStream, model: WakeModel, handlers: CaptureHandlers): Promise<Capture> {
  const context = new AudioContext();
  const workerUrl = blobUrl(workerSource);
  let worker: Worker;
  try {
    worker = new Worker(workerUrl, { type: 'module' });
  } catch (err) {
    URL.revokeObjectURL(workerUrl);
    void context.close();
    throw err;
  }
  const send = (message: ToWorker, transfer: Transferable[] = []) => worker.postMessage(message, transfer);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    worker.terminate();
    URL.revokeObjectURL(workerUrl);
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
    const moduleUrl = blobUrl(workletSource);
    try {
      await context.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
    const tap = new AudioWorkletNode(context, 'wake-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
      handlers.onInput?.(event.data, context.sampleRate);
      send({ type: 'audio', samples: event.data }, [event.data.buffer]);
    };
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
