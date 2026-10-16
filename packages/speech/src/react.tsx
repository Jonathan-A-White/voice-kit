// react.tsx — the React entry of @voice-kit/speech: the hook a speaker's button reads, and the one bar for anything read aloud
// (Postern's useSpeaking and SpeakingBar). The engine is the same module 'voice-kit/speech' exports, so both see one speech.
import { useEffect, useSyncExternalStore } from 'react';
import { getSpeech, isSpeaking, pause, restart, resume, stop, subscribe, type SpeechState } from './engine.js';

export type { SpeechState, SpeechStatus } from './engine.js';

/**
 * Whether the speech started under `key` is reading (or waits paused) now, so a speaker button can turn into Stop while it
 * reads and back when it ends. A screen that is left pauses the speech it started (Postern's mw-q6n8m0.10): the bar offers
 * Resume on the next screen and the button says Stop again when the listener comes back; only a new speech or Stop ends it.
 * Another speaker's speech is not touched.
 */
export function useSpeaking(key: string): boolean {
  useEffect(
    () => () => {
      if (isSpeaking(key)) pause();
    },
    [key],
  );
  return useSyncExternalStore(
    subscribe,
    () => isSpeaking(key),
    () => false,
  );
}

/** What is speaking now: whose, whether it plays or is paused, and the sentence reached. */
export function useSpeech(): SpeechState {
  return useSyncExternalStore(subscribe, getSpeech, getSpeech);
}

const PATHS = {
  play: 'M8 5v14l11-7L8 5Z',
  pause: 'M8 5h3v14H8zM13 5h3v14h-3z',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  stop: 'M7 7h10v10H7z',
} as const;

function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg
      className="bk-speech__icon"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

export interface SpeakingBarLabels {
  /** The region's name, for a screen reader. */
  region: string;
  pause: string;
  resume: string;
  restart: string;
  stop: string;
}

/** The words on the bar, as Postern's. */
export const DEFAULT_LABELS: SpeakingBarLabels = { region: 'Speaking', pause: 'Pause', resume: 'Resume', restart: 'Restart', stop: 'Stop' };

export interface SpeakingBarProps {
  /** Show the bar for every speech but the one started under this key (a screen that draws its own buttons for it). */
  except?: string;
  /** Any of the words on the bar. */
  labels?: Partial<SpeakingBarLabels>;
  /** A class added to the bar, beside `bk-speech`. */
  className?: string;
}

/**
 * The one bar for anything read aloud: Pause (Resume while paused), Restart and Stop, each at least 44 px high, shown while
 * something speaks or waits paused. In flow, never over text. Themed by `--bk-speech-*` properties (`voice-kit/speech/styles.css`).
 */
export function SpeakingBar({ except, labels, className }: SpeakingBarProps) {
  const speech = useSpeech();
  if (speech.status === 'idle') return null;
  if (except !== undefined && speech.key === except) return null;
  const words = { ...DEFAULT_LABELS, ...labels };
  const paused = speech.status === 'paused';
  return (
    <section aria-label={words.region} data-testid="speaking-bar" data-state={speech.status} className={className ? `bk-speech ${className}` : 'bk-speech'}>
      <button type="button" className="bk-speech__button" data-action={paused ? 'resume' : 'pause'} data-primary={paused ? 'true' : undefined} onClick={paused ? resume : pause}>
        <Icon name={paused ? 'play' : 'pause'} />
        {paused ? words.resume : words.pause}
      </button>
      <button type="button" className="bk-speech__button" data-action="restart" onClick={restart}>
        <Icon name="refresh" />
        {words.restart}
      </button>
      <button type="button" className="bk-speech__button" data-action="stop" onClick={stop}>
        <Icon name="stop" />
        {words.stop}
      </button>
    </section>
  );
}
