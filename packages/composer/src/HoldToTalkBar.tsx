// HoldToTalkBar.tsx (lifted from Postern's src/cockpit/HoldToTalkBar.tsx) — the big hold-to-talk bar: full width,
// rounded, the mic over its label. The caller says what a hold does (press, release, abort) and what the bar says;
// with `dropOnSlideOff` a finger that slides off the bar before letting go drops the hold (the bar says
// 'Let go to keep it unsent': the composer keeps the words in its box, mw-f7gmps.3) instead of sending it.
// Its look is the app's: the class bk-composer__bar, and data-state 'idle', 'listening', 'latched' or 'slid'.
// With settings.talk 'tap' (mw-06ggew.2) it works as whisper-hid's talkPress does: a press shorter than LATCH_MS leaves
// the mic on (latched; the bar says how to stop) and the next tap stops it; a longer press is a hold, as ever.
// With talk 'off' it renders nothing.
// The press logic is useBarPress (useTalk.ts), the one hook under this bar and TalkBar (mw-06ggew.3).
import type { ReactNode } from 'react';
import { Icon } from './icons.js';
import { type ComposerSettings } from './settings.js';
import { LATCH_MS, SLIDE_OFF_MARGIN_PX, useBarPress, type BarPress } from './useTalk.js';

export { LATCH_MS, SLIDE_OFF_MARGIN_PX };

export const DROP_LABEL = 'Let go to keep it unsent';

export const STOP_LABEL = 'Tap to stop';

export interface HoldToTalkBarProps {
  /** What a hold will do (or why it cannot be held now). */
  label: string;
  /** True while the bar is held. */
  listening: boolean;
  disabled: boolean;
  onPress: () => void;
  onRelease: () => void;
  onAbort: () => void;
  dropOnSlideOff?: boolean;
  /** What the bar says while the finger is off it (with `dropOnSlideOff`). */
  dropLabel?: string;
  /** What the bar says while the mic is kept on after a quick tap (talk 'tap'): how to stop. */
  latchedLabel?: string;
  /** The bar's settings (talk: 'hold' by default, 'tap' to latch, 'off' for no bar). */
  settings?: Partial<ComposerSettings>;
  className?: string;
}

/** The bar's button, drawn from a press (useBarPress): the look both bars share. */
export function BarButton({ press, label, dropLabel, latchedLabel, disabled, className }: { press: BarPress; label: ReactNode; dropLabel: string; latchedLabel: string; disabled: boolean; className?: string }) {
  if (press.talk === 'off') return null;
  return (
    <button
      type="button"
      disabled={disabled}
      {...press.handlers}
      data-state={press.state}
      className={className ? `bk-composer__bar ${className}` : 'bk-composer__bar'}
    >
      <Icon name="mic" size={26} />
      {press.slid ? dropLabel : press.latched ? latchedLabel : label}
    </button>
  );
}

export function HoldToTalkBar({ label, listening, disabled, onPress, onRelease, onAbort, dropOnSlideOff = false, dropLabel = DROP_LABEL, latchedLabel = STOP_LABEL, settings, className }: HoldToTalkBarProps) {
  const press = useBarPress({ settings, listening, onPress, onRelease, onAbort, dropOnSlideOff });
  return <BarButton press={press} label={label} dropLabel={dropLabel} latchedLabel={latchedLabel} disabled={disabled} className={className} />;
}
