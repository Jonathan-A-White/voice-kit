// TalkBar.tsx (mw-06ggew.3) — the hold-to-talk bar alone, for a caller with its own handler for the words (Lampas's Talk
// sheet, Reader, Welcome, LetterDrill). Drawn on useTalk, the Composer's bar look (bk-composer__bar), the same settings.talk
// ('hold', 'tap', or 'off': renders nothing). Pass the options (onWords, onHoldStart, onHoldEnd, ...) and the bar runs its own
// hold; or pass `talk` from your own useTalk when you also draw the words so far or the notice.
import { BarButton, DROP_LABEL, STOP_LABEL } from './HoldToTalkBar.js';
import type { ComposerSettings } from './settings.js';
import { useTalk, type Talk, type TalkOptions } from './useTalk.js';

export interface TalkLabels {
  /** Before a hold. */
  hold: string;
  /** A hold, the mic open. */
  release: string;
  /** A hold, the mic not yet open. */
  starting: string;
  /** Talk 'tap': the mic is on, tap to stop. */
  stop: string;
  /** The finger is off the bar: letting go keeps nothing. */
  drop: string;
  /** The last hold failed (the notice says why). */
  tryAgain: string;
}

export const DEFAULT_TALK_LABELS: TalkLabels = {
  hold: 'Hold to talk',
  release: 'Release to send',
  starting: 'Starting the mic…',
  stop: STOP_LABEL,
  drop: DROP_LABEL,
  tryAgain: 'Try again',
};

interface BarLook {
  /** Words to put on the bar in place of the defaults (DEFAULT_TALK_LABELS). */
  labels?: Partial<TalkLabels>;
  /** Nothing can be held (the app is not ready). */
  disabled?: boolean;
  className?: string;
}

export type TalkBarProps = BarLook &
  (
    | (TalkOptions & {
        /** The bar's settings (talk: 'hold' by default, 'tap' to latch, 'off' for no bar). */
        settings?: Partial<ComposerSettings>;
        talk?: undefined;
      })
    | {
        /** A hold you run yourself with useTalk, to draw its words or notice beside the bar. */
        talk: Talk;
      }
  );

export function TalkBar(props: TalkBarProps) {
  return props.talk ? <Drawn talk={props.talk} {...look(props)} /> : <Own {...(props as BarLook & TalkOptions & { settings?: Partial<ComposerSettings> })} />;
}

function look({ labels, disabled, className }: BarLook): Required<Pick<BarLook, 'disabled'>> & Pick<BarLook, 'labels' | 'className'> {
  return { labels, disabled: disabled ?? false, className };
}

function Own({ labels, disabled, className, settings, ...options }: BarLook & TalkOptions & { settings?: Partial<ComposerSettings> }) {
  const talk = useTalk(settings, options);
  return <Drawn talk={talk} labels={labels} disabled={disabled ?? false} className={className} />;
}

function Drawn({ talk, labels, disabled, className }: { talk: Talk; labels?: Partial<TalkLabels>; disabled: boolean; className?: string }) {
  const words = { ...DEFAULT_TALK_LABELS, ...labels };
  const label = talk.listening ? (talk.mic === 'ready' ? words.release : words.starting) : talk.notice ? words.tryAgain : words.hold;
  const press = { talk: talk.talk, state: talk.state, slid: talk.slid, latched: talk.latched, handlers: talk.bar };
  return <BarButton press={press} label={label} dropLabel={words.drop} latchedLabel={talk.mic === 'ready' ? words.stop : words.starting} disabled={disabled} className={className} />;
}
