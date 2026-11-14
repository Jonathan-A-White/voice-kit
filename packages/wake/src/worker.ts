// The wake detector's Web Worker: the page sends it the model and then the microphone's samples in batches; it answers
// with each wake and, about once per second of audio, what the detector has cost so far. Detection runs here so the
// page's own work (the meter, the log, the audio element) never waits on it.
import { createDetector, loadModel } from './detector.js';
import type { Detector, DetectorStats, Wake, WakeModel } from './detector.js';

/** What the page sends. */
export type ToWorker = { type: 'init'; model: WakeModel; inputRate: number } | { type: 'audio'; samples: Float32Array };

/** What the worker answers. */
export type FromWorker = { type: 'ready'; parameters: number } | { type: 'wake'; wake: Wake } | { type: 'stats'; stats: DetectorStats } | { type: 'error'; message: string };

interface Scope {
  postMessage(message: FromWorker): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}
const scope = self as unknown as Scope;

let detector: Detector | undefined;
let lastReport = 0;

scope.onmessage = (event) => {
  const message = event.data;
  try {
    if (message.type === 'init') {
      const net = loadModel(message.model);
      detector = createDetector(net, { inputRate: message.inputRate });
      scope.postMessage({ type: 'ready', parameters: net.parameters });
      return;
    }
    if (!detector) return;
    for (const wake of detector.push(message.samples)) scope.postMessage({ type: 'wake', wake });
    const stats = detector.stats();
    if (stats.audioSeconds - lastReport >= 1) {
      lastReport = stats.audioSeconds;
      scope.postMessage({ type: 'stats', stats });
    }
  } catch (err) {
    scope.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
