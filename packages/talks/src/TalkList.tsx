// TalkList.tsx (mw-79en7t.31) — the talks kept in a store, as a list he can search and open. Carved from Lampas's
// src/Conversations.tsx (every conversation kept on the phone, newest first, one search field over their words, a tap opens one)
// with the Bible parts left behind: it reads a TalkStore (list, and searchTalks over it) and tells the app which talk was
// tapped; what opening it looks like (a sheet, a route, a Composer) is the app's. Own entry point (`voice-kit/talks/react`).
import { useEffect, useState, type ReactNode } from 'react';
import { searchTalks } from './search.js';
import type { TalkStore } from './store.js';

/** The words TalkList shows; any left out are the English below. */
export interface TalkListLabels {
  /** the search field's placeholder */
  placeholder: string;
  /** the search field's accessible name */
  searchLabel: string;
  /** the list's accessible name */
  listLabel: string;
  /** shown for a talk with no title */
  untitled: string;
  /** shown when there are no talks */
  empty: string;
  /** shown when a search finds nothing */
  noMatches: string;
  /** shown when the store could not be read */
  failed: string;
  /** the count of turns, as a row says it */
  turns: (count: number) => string;
}

export const DEFAULT_TALK_LIST_LABELS: TalkListLabels = {
  placeholder: 'Search your conversations',
  searchLabel: 'Search conversations',
  listLabel: 'Conversations',
  untitled: 'Untitled talk',
  empty: 'No conversations yet. Each talk you have is kept here.',
  noMatches: 'No conversation has those words in a question or an answer.',
  failed: 'The conversations could not be read.',
  turns: (count) => (count === 1 ? '1 turn' : `${count} turns`),
};

export interface TalkListProps {
  store: TalkStore;
  /** He tapped a talk: its id. */
  onOpen: (id: string) => void;
  /** The most talks listed: all unless given. */
  limit?: number;
  /** Change this to read the store again (after a talk was added to, renamed or removed). */
  refreshKey?: unknown;
  labels?: Partial<TalkListLabels>;
  /** How a time is drawn on a row; the locale's date unless given. */
  formatTime?: (ms: number) => ReactNode;
  className?: string;
}

interface Row {
  id: string;
  title: string;
  line: string;
  updatedAt: number;
  turnCount?: number;
}

type Loaded = { status: 'loading' } | { status: 'ready'; rows: Row[] } | { status: 'failed' };

const cx = (...names: (string | undefined)[]): string => names.filter(Boolean).join(' ');
const defaultFormatTime = (ms: number): string => new Date(ms).toLocaleDateString();

/** A searchable list of the talks in a store; a tap calls `onOpen` with the talk's id. Style it with `voice-kit/talks/styles.css` or the bk-talklist classes. */
export function TalkList({ store, onOpen, limit, refreshKey, labels, formatTime = defaultFormatTime, className }: TalkListProps) {
  const text = { ...DEFAULT_TALK_LIST_LABELS, ...labels };
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const searching = query.trim() !== '';

  useEffect(() => {
    let current = true;
    const load = async (): Promise<Row[]> => {
      if (searching) {
        // the line under a found talk is the first turn that matched; the title is already on the row
        return (await searchTalks(store, query, { limit })).map((hit) => ({
          id: hit.id,
          title: hit.title,
          line: hit.matches.find((m) => m.in === 'turn')?.snippet ?? '',
          updatedAt: hit.updatedAt,
        }));
      }
      return (await store.list({ limit })).map((t) => ({ id: t.id, title: t.title, line: t.firstText, updatedAt: t.updatedAt, turnCount: t.turnCount }));
    };
    load().then(
      (rows) => current && setLoaded({ status: 'ready', rows }),
      () => current && setLoaded({ status: 'failed' }),
    );
    return () => {
      current = false;
    };
  }, [store, query, searching, limit, refreshKey]);

  return (
    <div className={cx('bk-talklist', className)}>
      <input
        type="search"
        className="bk-talklist__search"
        value={query}
        placeholder={text.placeholder}
        aria-label={text.searchLabel}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        onChange={(e) => setQuery(e.target.value)}
      />
      {loaded.status === 'failed' ? (
        <p role="alert" className="bk-talklist__note">
          {text.failed}
        </p>
      ) : loaded.status === 'loading' ? null : loaded.rows.length === 0 ? (
        <p className="bk-talklist__note">{searching ? text.noMatches : text.empty}</p>
      ) : (
        <ul aria-label={text.listLabel} className="bk-talklist__list">
          {loaded.rows.map((row) => (
            <li key={row.id} className="bk-talklist__item">
              <button type="button" className="bk-talklist__row" onClick={() => onOpen(row.id)}>
                <span className="bk-talklist__title">{row.title || text.untitled}</span>
                {row.line ? <span className="bk-talklist__line">{row.line}</span> : null}
                <span className="bk-talklist__meta">
                  <span>{formatTime(row.updatedAt)}</span>
                  {row.turnCount === undefined ? null : <span>{text.turns(row.turnCount)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
