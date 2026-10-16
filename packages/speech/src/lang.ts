// lang.ts — which language a text is read in. The phone's speech engine is shared by every app and keeps the last language
// used, so an utterance that names no language is read in whatever another app spoke last (a Greek voice reading English,
// Postern's mw-44omaq.7). Every utterance names its language, and a voice for it once the phone lists voices. A web app cannot
// read or restore the engine's own voice. The language is chosen from the letters: Greek and Hebrew text is read in its own
// language, anything in Latin letters in the app's (by default the phone's).

/** What Latin-letter text is read in when the phone names no language. */
export const DEFAULT_LANG = 'en-US';
export const GREEK_LANG = 'el-GR';
export const HEBREW_LANG = 'he-IL';

export type Script = 'greek' | 'hebrew' | 'latin';

const GREEK_LETTER = /\p{Script=Greek}/u;
const HEBREW_LETTER = /\p{Script=Hebrew}/u;
const LATIN_LETTER = /\p{Script=Latin}/u;

/** The script most of the letters of `text` are in; null when it has no Greek, Hebrew or Latin letter. */
export function scriptOf(text: string): Script | null {
  let greek = 0;
  let hebrew = 0;
  let latin = 0;
  for (const char of text) {
    if (GREEK_LETTER.test(char)) greek += 1;
    else if (HEBREW_LETTER.test(char)) hebrew += 1;
    else if (LATIN_LETTER.test(char)) latin += 1;
  }
  if (greek === 0 && hebrew === 0 && latin === 0) return null;
  if (latin >= greek && latin >= hebrew) return 'latin';
  return greek >= hebrew ? 'greek' : 'hebrew';
}

const primary = (tag: string): string => tag.split('-')[0];

/** A language tag as a voice lists it: lower case, with hyphens (some phones list el_GR), and the old iw for Hebrew as he. */
export function normaliseTag(lang: string): string {
  const tag = lang.trim().replace(/_/g, '-').toLowerCase();
  return primary(tag) === 'iw' ? `he${tag.slice(2)}` : tag;
}

/** The phone's language as a full tag: a bare 'en' (or none) becomes en-US, since Android Chrome wants the region. */
export function readingLang(lang?: string): string {
  const given = lang ?? (typeof navigator === 'undefined' ? undefined : navigator.language);
  const tag = given?.trim().replace(/_/g, '-');
  if (!tag || tag.toLowerCase() === 'en') return DEFAULT_LANG;
  return tag;
}

/** The language Latin-letter text is read in: the app's, else the phone's, but never Greek or Hebrew (that is not what Latin letters spell). */
export function latinLang(lang?: string): string {
  const wanted = readingLang(lang);
  const own = primary(normaliseTag(wanted));
  return own === 'el' || own === 'he' ? DEFAULT_LANG : wanted;
}

export interface LanguageOptions {
  /** What Latin-letter text is read in (default: the phone's language, as a full tag). */
  lang?: string;
  /** What text with no letter in a known script ('42.') is read in (default: the same as Latin-letter text). */
  fallback?: string;
}

/** The language tag to read `text` in, from its letters. */
export function languageOf(text: string, options: LanguageOptions = {}): string {
  switch (scriptOf(text)) {
    case 'greek':
      return GREEK_LANG;
    case 'hebrew':
      return HEBREW_LANG;
    case 'latin':
      return latinLang(options.lang);
    default:
      return options.fallback ?? latinLang(options.lang);
  }
}

/** The voice for `lang`: one of exactly that tag, else one of the same language. Undefined when the phone lists none. */
export function preferredVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | undefined {
  const want = normaliseTag(lang);
  const language = primary(want);
  return voices.find((voice) => normaliseTag(voice.lang) === want) ?? voices.find((voice) => primary(normaliseTag(voice.lang)) === language);
}
