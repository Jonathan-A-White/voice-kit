// @voice-kit/composer: Postern's message composer as a React component, and the hooks and services it is made of.
export { Composer, DEFAULT_LABELS, type ComposerLabels, type ComposerMessage, type ComposerMode, type ComposerProps, type OutgoingFile } from './Composer.js';
export { HoldToTalkBar, DROP_LABEL, LATCH_MS, SLIDE_OFF_MARGIN_PX, STOP_LABEL, type HoldToTalkBarProps } from './HoldToTalkBar.js';
export {
  DEFAULT_COMPOSER_SETTINGS,
  resolveSettings,
  type ComposerSend,
  type ComposerSettings,
  type ComposerTalk,
  type ResolvedSettings,
  type SettingsInput,
} from './settings.js';
export { useHold, micName, type HoldOptions, type Released } from './useHold.js';
export { browserSpeech, transcribeRecording, type Transcriber } from './transcriber.js';
export {
  startListening,
  isListenSupported,
  recognizerLang,
  listenError,
  listenRoutes,
  routeName,
  DEFAULT_APP_NAME,
  DEFAULT_LANG,
  INPUT_SILENT_MS,
  IDLE_RESTART_WAIT_MS,
  MAX_IDLE_RESTARTS,
  MIN_LIVE_STRETCH_MS,
  STOP_TIMEOUT_MS,
  type ListenError,
  type ListenErrorKind,
  type ListenMode,
  type ListenOptions,
  type ListenResult,
  type ListenRoute,
  type ListenSession,
  type ListenStart,
  type MicInput,
} from './listen.js';
export { canChooseInput, chooseInput, forgetSilentInputs, openBluetoothInput, openHoldInput, type HoldInput, type InputDevice } from './micInput.js';
export { VoiceRecorder, canRecord, formatDuration, pickMime, type Recording } from './recorder.js';
