// TalkList.tsx (mw-79en7t.31) — the talks kept in a store, as a list he can search and open. Carved from Lampas's
// src/Conversations.tsx (every conversation kept on the phone, newest first, one search field over their words, a tap opens one)
// with the Bible parts left behind: it reads a TalkReader (list, and searchTalks over it) and tells the app which talk was
// tapped; what opening it looks like (a sheet, a route, a Composer) is the app's. Own entry point (`voice-kit/talks/react`).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { searchTalks, type SearchOptions, type TalkHit } from './search.js';
import type { TalkReader, TalkSummary } from './store.js';

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

/** The parts of a TalkList an app may add classes to; they go beside the bk-talklist ones. */
export type TalkListPart = 'root' | 'searchWrap' | 'search' | 'note' | 'list' | 'item' | 'row';

/** A row as the list would draw it. */
export interface TalkListRow<F = Record<string, unknown>> {
  id: string;
  title: string;
  /** The first turn match's snippet when searching, else the talk's first text. */
  line: string;
  updatedAt: number;
  /** How many turns the talk has: set when the list is not a search. */
  turnCount?: number;
  /** The store's summary of the talk (its `fields` are the app's, if the reader fills them). */
  summary: TalkSummary<F>;
  /** What the search found in the talk: there only when searching. */
  hit?: TalkHit;
}

export interface TalkListProps<F = Record<string, unknown>> {
  /** Where the talks are read: a TalkStore, or any reader of list and get. */
  store: TalkReader<F>;
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
  /** The app draws the whole row inside the kit's <li>; `open` calls `onOpen` with the row's id. The kit's button row unless given. */
  renderRow?: (row: TalkListRow<F>, open: () => void) => ReactNode;
  /** Rows it refuses are not drawn, and do not count toward the empty note. */
  filter?: (row: TalkListRow<F>) => boolean;
  /** Options for `searchTalks` (places, fold, snippet, maxMatches); the list's `limit` is given with them. */
  search?: Omit<SearchOptions<F>, 'limit'>;
  /** The app's own note in place of the kit's <p>, given the kit's text. */
  renderNote?: (kind: 'empty' | 'noMatches' | 'failed', text: string) => ReactNode;
  /** Classes added beside the bk-talklist ones. */
  classNames?: Partial<Record<TalkListPart, string>>;
}

type Loaded<F> = { status: 'loading' } | { status: 'ready'; rows: TalkListRow<F>[] } | { status: 'failed' };

const cx = (...names: (string | undefined)[]): string => names.filter(Boolean).join(' ');
const defaultFormatTime = (ms: number): string => new Date(ms).toLocaleDateString();

/** A searchable list of the talks in a store; a tap calls `onOpen` with the talk's id. Style it with `voice-kit/talks/styles.css` or the bk-talklist classes. */
export function TalkList<F = Record<string, unknown>>({
  store,
  onOpen,
  limit,
  refreshKey,
  labels,
  formatTime = defaultFormatTime,
  className,
  renderRow,
  filter,
  search,
  renderNote,
  classNames = {},
}: TalkListProps<F>) {
  const text = { ...DEFAULT_TALK_LIST_LABELS, ...labels };
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState<Loaded<F>>({ status: 'loading' });
  const searching = query.trim() !== '';
  // the search options are read when a load starts, so an object made anew each render does not read the store again
  const searchOptions = useRef(search);
  searchOptions.current = search;

  useEffect(() => {
    let current = true;
    const load = async (): Promise<TalkListRow<F>[]> => {
      if (searching) {
        // the line under a found talk is the first turn that matched; the title is already on the row
        const hits = await searchTalks(store, query, { ...searchOptions.current, limit });
        const summaries = new Map((await store.list()).map((t) => [t.id, t]));
        const rows: TalkListRow<F>[] = [];
        for (const hit of hits) {
          const summary = summaries.get(hit.id);
          if (!summary) continue;
          rows.push({
            id: hit.id,
            title: hit.title,
            line: hit.matches.find((m) => m.in === 'turn')?.snippet ?? '',
            updatedAt: hit.updatedAt,
            summary,
            hit,
          });
        }
        return rows;
      }
      return (await store.list({ limit })).map((t) => ({ id: t.id, title: t.title, line: t.firstText, updatedAt: t.updatedAt, turnCount: t.turnCount, summary: t }));
    };
    load().then(
      (rows) => current && setLoaded({ status: 'ready', rows }),
      () => current && setLoaded({ status: 'failed' }),
    );
    return () => {
      current = false;
    };
  }, [store, query, searching, limit, refreshKey]);

  const shown = loaded.status === 'ready' && filter ? loaded.rows.filter(filter) : loaded.status === 'ready' ? loaded.rows : [];
  const note = (kind: 'empty' | 'noMatches' | 'failed', words: string): ReactNode =>
    renderNote ? (
      renderNote(kind, words)
    ) : (
      <p role={kind === 'failed' ? 'alert' : undefined} className={cx('bk-talklist__note', classNames.note)}>
        {words}
      </p>
    );

  return (
    <div className={cx('bk-talklist', className, classNames.root)}>
      <div className={cx('bk-talklist__searchwrap', classNames.searchWrap)}>
        <input
          type="search"
          className={cx('bk-talklist__search', classNames.search)}
          value={query}
          placeholder={text.placeholder}
          aria-label={text.searchLabel}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {loaded.status === 'failed' ? (
        note('failed', text.failed)
      ) : loaded.status === 'loading' ? null : shown.length === 0 ? (
        note(searching ? 'noMatches' : 'empty', searching ? text.noMatches : text.empty)
      ) : (
        <ul aria-label={text.listLabel} className={cx('bk-talklist__list', classNames.list)}>
          {shown.map((row) => {
            const open = () => onOpen(row.id);
            return (
              <li key={row.id} className={cx('bk-talklist__item', classNames.item)}>
                {renderRow ? (
                  renderRow(row, open)
                ) : (
                  <button type="button" className={cx('bk-talklist__row', classNames.row)} onClick={open}>
                    <span className="bk-talklist__title">{row.title || text.untitled}</span>
                    {row.line ? <span className="bk-talklist__line">{row.line}</span> : null}
                    <span className="bk-talklist__meta">
                      <span>{formatTime(row.updatedAt)}</span>
                      {row.turnCount === undefined ? null : <span>{text.turns(row.turnCount)}</span>}
                    </span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
