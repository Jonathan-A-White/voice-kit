// search.ts (mw-79en7t.30) — search over the titles and turns of the talks in a store. Lampas's list filtered its conversations
// by title; this looks in the turns too, and tells where it found the words. It reads only through the TalkReader interface
// (list, get), so it works for any store, and it matches by plain words: no index, no ranking beyond the order below.
import type { Role, TalkReader } from './store.js';

export interface SearchOptions {
  /** The most talks returned: all unless given. */
  limit?: number;
  /** The most matches kept in a talk's hit (matchCount still counts them all); 3 unless given. */
  maxMatches?: number;
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
const fold = (text: string): string => Array.from(text, foldChar).join('');

const snippetOf = (text: string, at: number, length: number): string => {
  const from = Math.max(0, at - BEFORE);
  const to = Math.min(text.length, at + length + AFTER);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ').trim()}${to < text.length ? '…' : ''}`;
};

/**
 * The talks in `store` with every word of `query` in their title or in one of their turns (a word is any run of letters between
 * spaces, matched anywhere in the text, ignoring case and accents). A talk whose title matches comes first, then the talk last
 * added to. A blank query finds nothing.
 */
export async function searchTalks(store: TalkReader, query: string, { limit, maxMatches = SEARCH_MAX_MATCHES }: SearchOptions = {}): Promise<TalkHit[]> {
  const terms = fold(query).split(/\s+/).filter((t) => t !== '');
  if (terms.length === 0) return [];
  const found = (text: string): number => {
    const folded = fold(text);
    return terms.every((t) => folded.includes(t)) ? folded.indexOf(terms[0]) : -1;
  };
  const hits: TalkHit[] = [];
  for (const { id } of await store.list()) {
    const talk = await store.get(id);
    if (!talk) continue;
    const matches: SearchMatch[] = [];
    if (found(talk.title) >= 0) matches.push({ in: 'title', snippet: talk.title });
    talk.turns.forEach((turn, index) => {
      const at = found(turn.text);
      if (at >= 0) matches.push({ in: 'turn', turn: index, role: turn.role, snippet: snippetOf(turn.text, at, terms[0].length) });
    });
    if (matches.length > 0) hits.push({ id, title: talk.title, updatedAt: talk.updatedAt, matchCount: matches.length, matches: matches.slice(0, maxMatches) });
  }
  hits.sort((a, b) => Number(b.matches[0].in === 'title') - Number(a.matches[0].in === 'title') || b.updatedAt - a.updatedAt);
  return limit === undefined ? hits : hits.slice(0, limit);
}
