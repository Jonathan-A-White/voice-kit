// store.ts (mw-79en7t.29) — what a kept talk is, and where talks are kept. Lampas kept the turns of a Bible talk per
// conversation in Dexie (src/data/repositories/talks.ts); this is the part that is not about the Bible: a Talk of turns with
// roles and times, an optional picture or two on a turn, a memory slot, and a store interface any back end can meet. The
// in-memory store is the reference: it is what tests use and what a Dexie store is held to (tests/store.test.ts).

/** A picture kept with a turn, or sent with a message: the bytes that went, their type and the name they went under. */
export interface Picture {
  bytes: Uint8Array;
  mime: string;
  name: string;
}

export type Role = 'user' | 'assistant';

/**
 * One thing said in a talk: who said it, the words, the pictures that went with it (his, not re-sent unless asked) and when (ms since the epoch).
 * `F` is what the app keeps with a turn beyond the kit's own (`fields`): the kit reads nothing in it and a store keeps it by copy.
 */
export interface Turn<F = Record<string, unknown>> {
  role: Role;
  text: string;
  pictures?: Picture[];
  at: number;
  /** What the app keeps with this turn; absent unless given. Plain data: a store copies it (structured clone, else JSON). */
  fields?: F;
}

/**
 * What a talk remembers beyond its turns: facts kept and a rolling summary. The slot is here so a store keeps it with the talk
 * and a delete takes it too; what fills it and folds it into a request is the memory step of this library.
 */
export interface TalkMemory {
  facts: string[];
  summary: string;
}

/** A conversation: its turns oldest first, and its memory. */
export interface Talk<F = Record<string, unknown>> {
  id: string;
  title: string;
  turns: Turn<F>[];
  memory: TalkMemory;
  /** ms since the epoch */
  createdAt: number;
  /** the time of the last turn, else of creation */
  updatedAt: number;
}

/** A talk as a list shows it: its title, how many turns, the first thing he said and when it was last added to. */
export interface TalkSummary<F = Record<string, unknown>> {
  id: string;
  title: string;
  turnCount: number;
  firstText: string;
  createdAt: number;
  updatedAt: number;
  /** The app's own summary of a talk. A store in this library never fills it; a reader an app writes over its own tables may. */
  fields?: F;
}

export interface CreateTalk {
  /** The title; empty unless given. */
  title?: string;
  /** The time of creation; the store's clock unless given. */
  now?: number;
}

/**
 * Where talks are kept. Every method is async (a Dexie or a remote store must be), and what comes out is a copy: changing it
 * changes nothing kept. A method that names a talk that is not there rejects with TalkNotFoundError, except `get` (undefined)
 * and `remove` (nothing to do).
 */
export interface TalkStore<F = Record<string, unknown>> {
  create(init?: CreateTalk): Promise<Talk<F>>;
  get(id: string): Promise<Talk<F> | undefined>;
  /** The talks, the one added to last first (at most `limit`). */
  list(options?: { limit?: number }): Promise<TalkSummary<F>[]>;
  /** Adds turns at the end, in the order given; returns the talk. */
  append(id: string, turns: Turn<F>[]): Promise<Talk<F>>;
  rename(id: string, title: string): Promise<Talk<F>>;
  setMemory(id: string, memory: TalkMemory): Promise<Talk<F>>;
  /** Forgets the talk: its turns, their pictures and its memory. */
  remove(id: string): Promise<void>;
}

/**
 * What a list and a search read through: `list` and `get` of a TalkStore, nothing to write. An app whose talks live in its own
 * tables gives one without pretending to create or rename; any TalkStore is one.
 */
export type TalkReader<F = Record<string, unknown>> = Pick<TalkStore<F>, 'list' | 'get'>;

/**
 * What the tutor client noted: a fact it asked back for and was given ('ask'), something it wanted that the app did not have or
 * would not do ('miss'), a turn taken on the screen ('turn', so ask-backs can be counted per turn: stats.ts), or an up-front
 * list applied for the screen ('weights', with its source in `name` and the list in `names`).
 */
export type TutorRecordKind = 'ask' | 'miss' | 'turn' | 'weights';

/** One line of the tutor record: when, on which screen, what, and the talk turn (his turn's place in the talk) it belongs to. */
export interface TutorRecord {
  /** ms since the epoch */
  at: number;
  screen: string;
  kind: TutorRecordKind;
  /** the fact, command or place by name; for a miss the answer named, what it wanted; for a turn empty; for weights who applied it ('grist' or 'app') */
  name: string;
  turn: number;
  /** for a miss: why it was not had */
  why?: string;
  /** for weights: the list applied */
  names?: string[];
}

/**
 * What the tutor client keeps beside the talks (tutorClient.ts): the record of what was asked back and missed, and each screen's
 * up-front list, the facts read for every request made there besides the core ones. The stores here keep both.
 */
export interface TutorStore {
  /** The names of the facts read up front on `screen`, in the order set (the newest last); empty until set. */
  upFront(screen: string): Promise<string[]>;
  setUpFront(screen: string, names: string[]): Promise<void>;
  /** Adds records at the end of the record, in the order given. */
  note(records: TutorRecord[]): Promise<void>;
  /** The record, oldest first: all of it, or one screen's. */
  record(screen?: string): Promise<TutorRecord[]>;
}

export class TalkNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`There is no talk ${JSON.stringify(id)}.`);
    this.name = 'TalkNotFoundError';
  }
}

const clonePicture = (p: Picture): Picture => ({ bytes: p.bytes.slice(), mime: p.mime, name: p.name });
/** A copy of an app's fields: a structured clone where there is one, else a JSON round trip. Shared by the stores of this library. */
export const copyFields = <F>(fields: F): F => (typeof structuredClone === 'function' ? structuredClone(fields) : (JSON.parse(JSON.stringify(fields)) as F));
const cloneTurn = <F>(t: Turn<F>): Turn<F> => ({
  role: t.role,
  text: t.text,
  ...(t.pictures ? { pictures: t.pictures.map(clonePicture) } : {}),
  at: t.at,
  ...(t.fields === undefined ? {} : { fields: copyFields(t.fields) }),
});
const cloneMemory = (m: TalkMemory): TalkMemory => ({ facts: [...m.facts], summary: m.summary });
const cloneTalk = <F>(t: Talk<F>): Talk<F> => ({ ...t, turns: t.turns.map(cloneTurn), memory: cloneMemory(t.memory) });
const cloneRecord = (r: TutorRecord): TutorRecord => ({ ...r, ...(r.names ? { names: [...r.names] } : {}) });

export interface MemoryStoreOptions {
  /** Makes the id of a new talk: a random UUID unless given. */
  newId?: () => string;
  /** The clock: Date.now unless given. */
  now?: () => number;
}

let counter = 0;
const defaultId = (): string => globalThis.crypto?.randomUUID?.() ?? `talk-${Date.now().toString(36)}-${(++counter).toString(36)}`;

/** A TalkStore in memory, with the tutor client's record and up-front lists: gone with the page. For tests, and for a talk that need not outlive the session. */
export function createMemoryStore<F = Record<string, unknown>>({ newId = defaultId, now = Date.now }: MemoryStoreOptions = {}): TalkStore<F> & TutorStore {
  const talks = new Map<string, Talk<F>>();
  const kept: TutorRecord[] = [];
  const lists = new Map<string, string[]>();
  const need = (id: string): Talk<F> => {
    const talk = talks.get(id);
    if (!talk) throw new TalkNotFoundError(id);
    return talk;
  };
  return {
    async create(init = {}) {
      const at = init.now ?? now();
      const talk: Talk<F> = { id: newId(), title: init.title ?? '', turns: [], memory: { facts: [], summary: '' }, createdAt: at, updatedAt: at };
      talks.set(talk.id, talk);
      return cloneTalk(talk);
    },
    async get(id) {
      const talk = talks.get(id);
      return talk ? cloneTalk(talk) : undefined;
    },
    async list({ limit } = {}) {
      const summaries = [...talks.values()]
        .map((t): TalkSummary<F> => ({
          id: t.id,
          title: t.title,
          turnCount: t.turns.length,
          firstText: t.turns.find((turn) => turn.role === 'user')?.text ?? '',
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return limit === undefined ? summaries : summaries.slice(0, limit);
    },
    async append(id, turns) {
      const talk = need(id);
      talk.turns.push(...turns.map(cloneTurn));
      if (turns.length > 0) talk.updatedAt = Math.max(talk.updatedAt, ...turns.map((t) => t.at));
      return cloneTalk(talk);
    },
    async rename(id, title) {
      const talk = need(id);
      talk.title = title;
      return cloneTalk(talk);
    },
    async setMemory(id, memory) {
      const talk = need(id);
      talk.memory = cloneMemory(memory);
      return cloneTalk(talk);
    },
    async remove(id) {
      talks.delete(id);
    },
    async upFront(screen) {
      return [...(lists.get(screen) ?? [])];
    },
    async setUpFront(screen, names) {
      lists.set(screen, [...names]);
    },
    async note(records) {
      kept.push(...records.map(cloneRecord));
    },
    async record(screen) {
      return kept.filter((r) => screen === undefined || r.screen === screen).map(cloneRecord);
    },
  };
}
