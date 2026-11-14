// @voice-kit/handsfree: the hands-free session, the spoken-command router and the three-finger tap (React lives in ./react.tsx, voice-kit/handsfree/react).
// createHandsFree is the state machine over ports; createBrowserHandsFree wires
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
export { defineSpoken, normaliseSpoken, route } from './router.js';
export type { SpokenPhrase, SpokenRoute, SpokenRule, SpokenRules } from './router.js';
export { CLICK_DROP_MS, TAP_MOVE_PX, TAP_WITHIN_MS, watchThreeFingerTaps } from './threeFingerTap.js';
export type { ThreeFingerTapOptions } from './threeFingerTap.js';
