// @voice-kit/handsfree: the hands-free session. createHandsFree is the state machine over ports; createBrowserHandsFree wires
// the real ones (voice-kit/wake's startWake, the WebAudio chimes, the document's visibility) around the app's listen.
export {
  createHandsFree,
  DEFAULT_FOLLOW_UP_MS,
  DEFAULT_MAX_COMMAND_MS,
  DEFAULT_NO_SPEECH_MS,
  DEFAULT_OPEN_TIMEOUT_MS,
  DEFAULT_PAUSE_MS,
} from './session.js';
export type {
  ChimePort,
  CloseReason,
  CommandDone,
  HandsFree,
  HandsFreeClock,
  HandsFreeFailureKind,
  HandsFreeHooks,
  HandsFreeOptions,
  HandsFreePorts,
  HandsFreeState,
  HandsFreeStateName,
  ListenPort,
  MicWay,
  VisibilityPort,
  WakePort,
  WakeRefused,
  WakeRunning,
} from './session.js';
export { CLOSE_CHIME, OPEN_CHIME, createChimes, playChime } from './chime.js';
export type { ChimeNote, ChimeShape, Chimes, ChimesOptions } from './chime.js';
export { browserWake, createBrowserHandsFree, documentVisibility } from './browser.js';
export type { BrowserHandsFreeOptions, BrowserWakeOptions } from './browser.js';
