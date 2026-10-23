// dexieStore.ts (mw-79en7t.31) — a TalkStore kept on the device in IndexedDB through Dexie. Lampas kept a Bible talk's turns this
// way (src/data/repositories/talks.ts); this is the part that is not about the Bible. It has its own database: one row per talk
// (its title, memory, times, and the count and first words a list shows, so a list reads no turns) and one row per turn; since
// version 2 (mw-t3xu9a.1) also the tutor client's record and each screen's up-front list (TutorStore). It is its own entry point
// (`voice-kit/talks/dexie`) so the core of @voice-kit/talks keeps importing nothing; the app installs `dexie` (an optional peer).
// It passes the same contract as the in-memory store (tests/storeContract.ts).
import { Dexie, type EntityTable } from 'dexie';
import {
  TalkNotFoundError,
  type CreateTalk,
  type Picture,
  type Talk,
  type TalkMemory,
  type TalkStore,
  type TalkSummary,
  type TutorRecord,
  type TutorStore,
  type Turn,
} from './store.js';

interface TalkRow {
  id: string;
  title: string;
  memory: TalkMemory;
  createdAt: number;
  updatedAt: number;
  turnCount: number;
  /** the first thing he said; undefined until he has said something */
  firstText?: string;
}

interface TurnRow extends Turn {
  /** the order the turns were kept in */
  seq?: number;
  talkId: string;
}

interface RecordRow extends TutorRecord {
  /** the order the records were noted in */
  seq?: number;
}

interface UpFrontRow {
  screen: string;
  names: string[];
}

class TalksDatabase extends Dexie {
  talks!: EntityTable<TalkRow, 'id'>;
  turns!: EntityTable<TurnRow, 'seq'>;
  tutorRecord!: EntityTable<RecordRow, 'seq'>;
  upFront!: EntityTable<UpFrontRow, 'screen'>;

  constructor(name: string, options?: { indexedDB?: IDBFactory; IDBKeyRange?: typeof IDBKeyRange }) {
    super(name, options);
    this.version(1).stores({ talks: 'id, updatedAt', turns: '++seq, talkId' });
    // 2 (mw-t3xu9a.1): the tutor client's record and each screen's up-front list; the talks are kept as they were
    this.version(2).stores({ tutorRecord: '++seq, screen', upFront: 'screen' });
  }
}

export interface DexieStoreOptions {
  /** The name of the IndexedDB database; 'voice-kit-talks' unless given. */
  name?: string;
  /** Makes the id of a new talk: a random UUID unless given. */
  newId?: () => string;
  /** The clock: Date.now unless given. */
  now?: () => number;
  /** For a place with no global IndexedDB (a test, a worker shim): the factory and key range to use. */
  indexedDB?: IDBFactory;
  IDBKeyRange?: typeof IDBKeyRange;
}

export interface DexieTalkStore extends TalkStore, TutorStore {
  /** Closes the database connection; the talks stay kept. Using the store again reopens it. */
  close(): void;
}

let counter = 0;
const defaultId = (): string => globalThis.crypto?.randomUUID?.() ?? `talk-${Date.now().toString(36)}-${(++counter).toString(36)}`;

// A typed array stored as a view would keep its whole underlying buffer: store a picture's bytes in a buffer of their own.
const keepPicture = (p: Picture): Picture => ({ bytes: p.bytes.slice(), mime: p.mime, name: p.name });
const keepTurn = (t: Turn): Turn => ({ role: t.role, text: t.text, ...(t.pictures ? { pictures: t.pictures.map(keepPicture) } : {}), at: t.at });
const turnOf = ({ role, text, pictures, at }: TurnRow): Turn => ({ role, text, ...(pictures ? { pictures } : {}), at });
const recordOf = ({ at, screen, kind, name, turn, why }: RecordRow): TutorRecord => ({ at, screen, kind, name, turn, ...(why === undefined ? {} : { why }) });
const talkOf = (row: TalkRow, turns: TurnRow[]): Talk => ({
  id: row.id,
  title: row.title,
  turns: turns.map(turnOf),
  memory: { facts: [...row.memory.facts], summary: row.memory.summary },
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** A TalkStore on the device: it outlives the page. Each method is one IndexedDB transaction. */
export function createDexieStore({ name = 'voice-kit-talks', newId = defaultId, now = Date.now, indexedDB, IDBKeyRange }: DexieStoreOptions = {}): DexieTalkStore {
  const db = new TalksDatabase(name, { indexedDB, IDBKeyRange });
  const need = async (id: string): Promise<TalkRow> => {
    const row = await db.talks.get(id);
    if (!row) throw new TalkNotFoundError(id);
    return row;
  };
  const read = async (id: string): Promise<Talk> => talkOf(await need(id), await db.turns.where('talkId').equals(id).sortBy('seq'));

  return {
    close: () => db.close(),
    async create(init: CreateTalk = {}) {
      const at = init.now ?? now();
      const row: TalkRow = { id: newId(), title: init.title ?? '', memory: { facts: [], summary: '' }, createdAt: at, updatedAt: at, turnCount: 0 };
      await db.talks.add(row);
      return talkOf(row, []);
    },
    async get(id) {
      return db.transaction('r', db.talks, db.turns, async () => {
        const row = await db.talks.get(id);
        return row ? talkOf(row, await db.turns.where('talkId').equals(id).sortBy('seq')) : undefined;
      });
    },
    async list({ limit } = {}) {
      const rows = await (limit === undefined ? db.talks.orderBy('updatedAt').reverse().toArray() : db.talks.orderBy('updatedAt').reverse().limit(limit).toArray());
      return rows.map((r): TalkSummary => ({ id: r.id, title: r.title, turnCount: r.turnCount, firstText: r.firstText ?? '', createdAt: r.createdAt, updatedAt: r.updatedAt }));
    },
    async append(id, turns) {
      return db.transaction('rw', db.talks, db.turns, async () => {
        const row = await need(id);
        if (turns.length > 0) {
          await db.turns.bulkAdd(turns.map((t) => ({ ...keepTurn(t), talkId: id })));
          const firstSaid = row.firstText === undefined ? turns.find((t) => t.role === 'user') : undefined;
          await db.talks.update(id, {
            turnCount: row.turnCount + turns.length,
            updatedAt: Math.max(row.updatedAt, ...turns.map((t) => t.at)),
            ...(firstSaid ? { firstText: firstSaid.text } : {}),
          });
        }
        return read(id);
      });
    },
    async rename(id, title) {
      return db.transaction('rw', db.talks, db.turns, async () => {
        await need(id);
        await db.talks.update(id, { title });
        return read(id);
      });
    },
    async setMemory(id, memory) {
      return db.transaction('rw', db.talks, db.turns, async () => {
        await need(id);
        await db.talks.update(id, { memory: { facts: [...memory.facts], summary: memory.summary } });
        return read(id);
      });
    },
    async remove(id) {
      await db.transaction('rw', db.talks, db.turns, async () => {
        await db.turns.where('talkId').equals(id).delete();
        await db.talks.delete(id);
      });
    },
    async upFront(screen) {
      return [...((await db.upFront.get(screen))?.names ?? [])];
    },
    async setUpFront(screen, names) {
      await db.upFront.put({ screen, names: [...names] });
    },
    async note(records) {
      if (records.length > 0) await db.tutorRecord.bulkAdd(records.map(recordOf));
    },
    async record(screen) {
      const rows = await (screen === undefined ? db.tutorRecord.orderBy('seq').toArray() : db.tutorRecord.where('screen').equals(screen).sortBy('seq'));
      return rows.map(recordOf);
    },
  };
}
