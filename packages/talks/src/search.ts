// search.ts (mw-79en7t.30) — search over the titles and turns of the talks in a store. Lampas's list filtered its conversations
// by title; this looks in the turns too, and tells where it found the words. It reads only through the TalkReader interface
// (list, get), so it works for any store, and it matches by plain words: no index, no ranking beyond the order below.
import type { Role, Talk, TalkReader } from './store.js';

/** One place a talk is searched: its title, or some text of its turns (`turn` and `role` say which turn it stands for). */
export interface SearchPlace {
  in: 'title' | 'turn';
  turn?: number;
  role?: Role;
  text: string;
}

export interface SearchOptions<F = Record<string, unknown>> {
  /** The most talks returned: all unless given. */
  limit?: number;
  /** The most matches kept in a talk's hit (matchCount still counts them all); 3 unless given. Infinity keeps every match. */
  maxMatches?: number;
  /**
   * The places searched in a talk, in order: the title, then each turn, unless given. A place holds the words that must all be
   * found together, so an app may make one place of a question and its answer.
   */
  places?: (talk: Talk<F>) => SearchPlace[];
  /**
   * How a text and the query are folded before they are matched: `foldText` (case and accents) unless given. The index found is
   * an index in the folded text, used in the original, so a fold must keep the length, as the default does, or the app gives a
   * `snippet` of its own.
   */
  fold?: (text: string) => string;
  /**
   * The line shown for a turn match, from the place's own text, the index of the first word in the folded text and that word
   * (folded): `defaultSnippet` unless given.
   */
  snippet?: (text: string, at: number, term: string) => string;
}

/** Where the words were found: the title, or a turn (its index in the talk's turns). */
export interface SearchMatch {
  in: 'title' | 'turn';
  turn?: number;
  role?: Role;
  /** The title, or the words around the first of the query's words in the turn, cut to a line. */
  snippet: string;
}

export interface TalkHit {
  id: string;
  title: string;
  updatedAt: number;
  /** How many places matched (the title and each turn). */
  matchCount: number;
  /** The first `maxMatches` of them: the title first, then the turns oldest first. */
  matches: SearchMatch[];
}

export const SEARCH_MAX_MATCHES = 3;
const BEFORE = 30;
const AFTER = 60;

// Folds case and accents one character at a time, so an index in the folded text is an index in the original.
const foldChar = (ch: string): string => {
  const folded = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  return folded.length === ch.length ? folded : ch;
};
/** The kit's fold: case and accents, one character at a time, so the folded text is as long as the original. */
export const foldText = (text: string): string => Array.from(text, foldChar).join('');

/** The kit's line for a match: the 30 characters before the word and the 60 after it, on one line, with … where it was cut. */
export const defaultSnippet = (text: string, at: number, term: string): string => {
  const from = Math.max(0, at - BEFORE);
  const to = Math.min(text.length, at + term.length + AFTER);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ').trim()}${to < text.length ? '…' : ''}`;
};

const defaultPlaces = <F>(talk: Talk<F>): SearchPlace[] => [
  { in: 'title', text: talk.title },
  ...talk.turns.map((turn, index): SearchPlace => ({ in: 'turn', turn: index, role: turn.role, text: turn.text })),
];

/**
 * The talks in `store` with every word of `query` in their title or in one of their turns (a word is any run of letters between
 * spaces, matched anywhere in the text, ignoring case and accents). A talk whose title matches comes first, then the talk last
 * added to. A blank query finds nothing.
 */
export async function searchTalks<F = Record<string, unknown>>(
  reader: TalkReader<F>,
  query: string,
  { limit, maxMatches = SEARCH_MAX_MATCHES, places = defaultPlaces, fold = foldText, snippet = defaultSnippet }: SearchOptions<F> = {},
): Promise<TalkHit[]> {
  const terms = fold(query).split(/\s+/).filter((t) => t !== '');
  if (terms.length === 0) return [];
  const found = (text: string): number => {
    const folded = fold(text);
    return terms.every((t) => folded.includes(t)) ? folded.indexOf(terms[0]) : -1;
  };
  const hits: TalkHit[] = [];
  for (const { id } of await reader.list()) {
    const talk = await reader.get(id);
    if (!talk) continue;
    const matches: SearchMatch[] = [];
    for (const place of places(talk)) {
      const at = found(place.text);
      if (at < 0) continue;
      if (place.in === 'title') matches.push({ in: 'title', snippet: place.text });
      else matches.push({ in: 'turn', turn: place.turn, role: place.role, snippet: snippet(place.text, at, terms[0]) });
    }
    if (matches.length > 0) hits.push({ id, title: talk.title, updatedAt: talk.updatedAt, matchCount: matches.length, matches: matches.slice(0, maxMatches) });
  }
  hits.sort((a, b) => Number(b.matches[0].in === 'title') - Number(a.matches[0].in === 'title') || b.updatedAt - a.updatedAt);
  return limit === undefined ? hits : hits.slice(0, limit);
}
