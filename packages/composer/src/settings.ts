// settings.ts (mw-06ggew.2) — ONE settings object for the composer: how the mic is worked (talk), what letting go does
// (send), and what is on offer (type, attach, camera, voiceNote), plus the language. The Composer and the HoldToTalkBar
// both read it, and only through resolveSettings, so an app turns things on and off in one place. The props the
// composer had before the object (mode, attach, camera, recordVoice, lang) are its fallbacks: nothing breaks until
// an app moves.

/** How the mic is worked: 'hold' (hold the bar), 'tap' (hold it, or tap it to keep it on and tap again to stop) or 'off' (no mic). */
export type ComposerTalk = 'hold' | 'tap' | 'off';

/** What letting go does: 'release' sends the words; 'button' puts them in the text box for the reader to fix, and Send sends them. */
export type ComposerSend = 'release' | 'button';

/** Speak-first (the big bar) or type-first (the text box and Send, with a small mic). */
export type ComposerMode = 'speak' | 'type';

/** What shows when the composer opens, and again after a send: the hold bar, or the text box (the mic beside it brings the bar out). */
export type ComposerOpen = 'bar' | 'box';

export interface ComposerSettings {
  talk: ComposerTalk;
  send: ComposerSend;
  /** Offer typing: the 'Type a message' button under the bar. Off, the text box still shows for words a hold leaves in it. */
  type: boolean;
  /** The attach button (any file from the picker; paste and drop too). */
  attach: boolean;
  /** The camera button (a photo, on a phone). */
  camera: boolean;
  /** Record the voice of each hold and send it with the words as a voice note. */
  voiceNote: boolean;
  /** The language to listen for; the page's own (`<html lang>`) when not given. */
  lang?: string;
}

export const DEFAULT_COMPOSER_SETTINGS: ComposerSettings = {
  talk: 'hold',
  send: 'release',
  type: true,
  attach: false,
  camera: false,
  voiceNote: false,
};

/** What the components read: the settings, all decided, and the layout the composer opens in. */
export interface ResolvedSettings extends ComposerSettings {
  mode: ComposerMode;
  open: ComposerOpen;
}

/** What resolveSettings reads: the settings object, and the props that came before it. */
export interface SettingsInput {
  settings?: Partial<ComposerSettings>;
  /** Fallback layout. */
  mode?: ComposerMode;
  /** What shows first (mw-06ggew.12); by default the bar in 'speak' layout, the box in 'type'. */
  open?: ComposerOpen;
  /** Fallback for `settings.attach`. */
  attach?: boolean;
  /** Fallback for `settings.camera`. */
  camera?: boolean;
  /** Fallback for `settings.voiceNote`. */
  recordVoice?: boolean;
  /** Fallback for `settings.lang`. */
  lang?: string;
}

/**
 * The one place the composer's choices are decided. A value in `settings` wins; where it is absent the old prop
 * is used, and where that is absent too, DEFAULT_COMPOSER_SETTINGS. Two things are kept true so the reader is never stranded:
 * with the mic off, typing is on; and type-first needs typing, so with typing off it opens speak-first.
 * `open` (the bar or the box first) is read here with the mode: with no mic the box is all there is, and with typing off the bar is.
 */
export function resolveSettings({ settings, mode, open, attach, camera, recordVoice, lang }: SettingsInput = {}): ResolvedSettings {
  const talk = settings?.talk ?? DEFAULT_COMPOSER_SETTINGS.talk;
  const type = talk === 'off' ? true : (settings?.type ?? DEFAULT_COMPOSER_SETTINGS.type);
  const resolved: ResolvedSettings = {
    talk,
    send: settings?.send ?? DEFAULT_COMPOSER_SETTINGS.send,
    type,
    attach: settings?.attach ?? attach ?? DEFAULT_COMPOSER_SETTINGS.attach,
    camera: settings?.camera ?? camera ?? DEFAULT_COMPOSER_SETTINGS.camera,
    voiceNote: settings?.voiceNote ?? recordVoice ?? DEFAULT_COMPOSER_SETTINGS.voiceNote,
    mode: type ? (mode ?? 'speak') : 'speak',
    open: talk === 'off' ? 'box' : !type ? 'bar' : (open ?? (mode === 'type' ? 'box' : 'bar')),
  };
  const language = settings?.lang ?? lang;
  if (language !== undefined) resolved.lang = language;
  return resolved;
}
