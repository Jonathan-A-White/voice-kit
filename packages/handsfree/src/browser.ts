// browser.ts: the real ports in one call. The wake is voice-kit/wake's startWake with the model (fetched once from modelUrl,
// then the parsed model is reused for every later start, as 'handover' starts the wake again after each command); the chimes
// are chime.ts's on one AudioContext, whose ready() also tells a page that needs a touch; the visibility is the document's;
// the listen is the app's own (composer's startListening, or its own of that shape), passed in.
import { startWake as kitStartWake } from 'voice-kit/wake';
import type { StartWakeResult, WakeModel, WakeOptions } from 'voice-kit/wake';
import { createChimes, type Chimes, type ChimesOptions } from './chime.js';
import { createHandsFree, type HandsFree, type HandsFreeHooks, type HandsFreeOptions, type ListenPort, type VisibilityPort, type WakePort } from './session.js';

export interface BrowserWakeOptions {
  /** The parsed model (voice-kit/wake/models/hey-lampas.json). Give this or modelUrl. */
  model?: WakeModel;
  /** Where to fetch the model from, once. */
  modelUrl?: string;
  /** Resolves false when audio cannot start without a touch: the wake is not started and the session says needs-touch. */
  ready?: () => Promise<boolean>;
  /** Passed to startWake. */
  onError?: WakeOptions['onError'];
  /** The startWake to call; voice-kit/wake's by default (a test may give its own). */
  startWake?: (options: WakeOptions) => Promise<StartWakeResult>;
}

/** The wake port over startWake. */
export function browserWake(options: BrowserWakeOptions): WakePort {
  let model = options.model;
  const start = options.startWake ?? kitStartWake;
  return {
    async start(onWake) {
      if (options.ready && !(await options.ready())) {
        return { ok: false, kind: 'needs-touch', message: 'The audio will not start until the page is touched.' };
      }
      const result = await start({
        ...(model ? { model } : { modelUrl: options.modelUrl }),
        onWake: () => onWake(),
        ...(options.onError ? { onError: options.onError } : {}),
      });
      if (!result.ok) return { ok: false, kind: result.kind, message: result.message };
      if (result.model) model = result.model;
      return { ok: true, track: result.track, stop: result.stop };
    },
  };
}

/** The document's visibility as a port. */
export function documentVisibility(doc: Document = document): VisibilityPort {
  return {
    isHidden: () => doc.visibilityState === 'hidden',
    onChange(listener) {
      const handler = () => listener();
      doc.addEventListener('visibilitychange', handler);
      return () => doc.removeEventListener('visibilitychange', handler);
    },
  };
}

export interface BrowserHandsFreeOptions extends HandsFreeHooks, HandsFreeOptions {
  /** The app's listen: composer's startListening, or its own of that shape. */
  listen: ListenPort;
  /** The parsed wake model. Give this or modelUrl. */
  model?: WakeModel;
  /** Where to fetch the wake model from (once). */
  modelUrl?: string;
  /** The document whose visibility stops and starts the session; default the global document (none: visibility is not watched). */
  document?: Document;
  /** Options for the chimes (another AudioContext, other shapes), or chimes of the app's own. */
  chimes?: ChimesOptions | Chimes;
  /** Passed to startWake: a failure of the wake after its start. */
  onWakeError?: (message: string) => void;
}

/** The hands-free session on the browser's own parts: startWake, the WebAudio chimes, the document's visibility. */
export function createBrowserHandsFree(options: BrowserHandsFreeOptions): HandsFree {
  const { listen, model, modelUrl, document: doc, chimes: chimeOptions, onWakeError, onOpen, onCommand, onInterrupt, onClose, onState, ...sessionOptions } = options;
  const chimes = chimeOptions && 'ready' in chimeOptions ? chimeOptions : createChimes(chimeOptions);
  const page = doc ?? (typeof document === 'undefined' ? undefined : document);
  return createHandsFree(
    {
      wake: browserWake({ model, modelUrl, ready: () => chimes.ready(), ...(onWakeError ? { onError: onWakeError } : {}) }),
      listen,
      chime: chimes,
      ...(page ? { visibility: documentVisibility(page) } : {}),
      onOpen,
      onCommand,
      onInterrupt,
      onClose,
      onState,
    },
    sessionOptions,
  );
}
