// talks.ts (mw-79en7t.31) — honest fakes for an app's tests of a talk: a grind that answers scripted turns, and a store that keeps
// talks in memory and records every call. Like the rest of this package it imports nothing: the shapes below are structurally
// the ones @voice-kit/talks has (a `send(request, files)` grind, a TalkStore), so they plug into createTalks as they are.

/** A file that goes with a request, as @voice-kit/talks sends it. */
export interface FakeGrindFile {
  bytes: Uint8Array;
  mime: string;
  name: string;
}

/** One scripted turn: the answer; a function of the request that makes it; or an Error, which the grind rejects with. */
export type ScriptedAnswer<Request, Answer> = Answer | Error | ((request: Request, files: FakeGrindFile[]) => Answer | Promise<Answer>);

export interface GrindCall<Request> {
  request: Request;
  files: FakeGrindFile[];
}

export interface FakeGrind<Request, Answer> {
  /** The grind to hand to createTalks as `send`. */
  send: (request: Request, files: FakeGrindFile[]) => Promise<Answer>;
  /** Every call so far, in order. */
  calls: GrindCall<Request>[];
}

/**
 * A grind that answers the scripted turns in order, one for each call, and records each call. A script that is used up rejects
 * rather than inventing an answer: a test that asks more than it scripted should fail.
 */
export function createFakeGrind<Request = unknown, Answer = unknown>(script: ScriptedAnswer<Request, Answer>[]): FakeGrind<Request, Answer> {
  const calls: GrindCall<Request>[] = [];
  let next = 0;
  return {
    calls,
    async send(request, files) {
      calls.push({ request, files });
      if (next >= script.length) throw new Error(`The fake grind's script is used up: it has ${script.length} answer(s) and was asked ${calls.length} time(s).`);
      const scripted = script[next++];
      if (scripted instanceof Error) throw scripted;
      return typeof scripted === 'function' ? (scripted as (request: Request, files: FakeGrindFile[]) => Answer | Promise<Answer>)(request, files) : scripted;
    },
  };
}

export interface FakePicture {
  bytes: Uint8Array;
  mime: string;
  name: string;
}
export interface FakeTurn {
  role: 'user' | 'assistant';
  text: string;
  pictures?: FakePicture[];
  at: number;
}
export interface FakeTalkMemory {
  facts: string[];
  summary: string;
}
export interface FakeTalk {
  id: string;
  title: string;
  turns: FakeTurn[];
  memory: FakeTalkMemory;
  createdAt: number;
  updatedAt: number;
}
export interface FakeTalkSummary {
  id: string;
  title: string;
  turnCount: number;
  firstText: string;
  createdAt: number;
  updatedAt: number;
}

export type FakeTalkStoreMethod = 'create' | 'get' | 'list' | 'append' | 'rename' | 'setMemory' | 'remove';

/** A call on the store: the method and the arguments it was given. */
export interface TalkStoreCall {
  method: FakeTalkStoreMethod;
  args: unknown[];
}

export interface FakeTalkStoreOptions {
  /** Makes the id of a new talk: 'talk-1', 'talk-2' ... unless given. */
  newId?: () => string;
  /** The clock: Date.now unless given (fake timers move it). */
  now?: () => number;
}

export interface FakeTalkStore {
  create(init?: { title?: string; now?: number }): Promise<FakeTalk>;
  get(id: string): Promise<FakeTalk | undefined>;
  list(options?: { limit?: number }): Promise<FakeTalkSummary[]>;
  append(id: string, turns: FakeTurn[]): Promise<FakeTalk>;
  rename(id: string, title: string): Promise<FakeTalk>;
  setMemory(id: string, memory: FakeTalkMemory): Promise<FakeTalk>;
  remove(id: string): Promise<void>;
  /** Every call so far, in order, with its arguments. */
  calls: TalkStoreCall[];
}

const clonePicture = (p: FakePicture): FakePicture => ({ bytes: p.bytes.slice(), mime: p.mime, name: p.name });
const cloneTurn = (t: FakeTurn): FakeTurn => ({ role: t.role, text: t.text, ...(t.pictures ? { pictures: t.pictures.map(clonePicture) } : {}), at: t.at });
const cloneTalk = (t: FakeTalk): FakeTalk => ({ ...t, turns: t.turns.map(cloneTurn), memory: { facts: [...t.memory.facts], summary: t.memory.summary } });

/**
 * A TalkStore in memory that records every call (`calls`), for a test of an app that keeps talks. It behaves as the real stores
 * do: copies out, a talk that is not there rejects (except `get` and `remove`), the list newest activity first.
 */
export function createFakeTalkStore({ newId, now = Date.now }: FakeTalkStoreOptions = {}): FakeTalkStore {
  const talks = new Map<string, FakeTalk>();
  const calls: TalkStoreCall[] = [];
  let made = 0;
  const idOf = newId ?? ((): string => `talk-${++made}`);
  const record = (method: FakeTalkStoreMethod, ...args: unknown[]): void => {
    calls.push({ method, args });
  };
  const need = (id: string): FakeTalk => {
    const talk = talks.get(id);
    if (!talk) throw new Error(`There is no talk ${JSON.stringify(id)}.`);
    return talk;
  };
  return {
    calls,
    async create(init = {}) {
      record('create', init);
      const at = init.now ?? now();
      const talk: FakeTalk = { id: idOf(), title: init.title ?? '', turns: [], memory: { facts: [], summary: '' }, createdAt: at, updatedAt: at };
      talks.set(talk.id, talk);
      return cloneTalk(talk);
    },
    async get(id) {
      record('get', id);
      const talk = talks.get(id);
      return talk ? cloneTalk(talk) : undefined;
    },
    async list(options = {}) {
      record('list', options);
      const summaries = [...talks.values()]
        .map((t): FakeTalkSummary => ({
          id: t.id,
          title: t.title,
          turnCount: t.turns.length,
          firstText: t.turns.find((turn) => turn.role === 'user')?.text ?? '',
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return options.limit === undefined ? summaries : summaries.slice(0, options.limit);
    },
    async append(id, turns) {
      record('append', id, turns);
      const talk = need(id);
      talk.turns.push(...turns.map(cloneTurn));
      if (turns.length > 0) talk.updatedAt = Math.max(talk.updatedAt, ...turns.map((t) => t.at));
      return cloneTalk(talk);
    },
    async rename(id, title) {
      record('rename', id, title);
      const talk = need(id);
      talk.title = title;
      return cloneTalk(talk);
    },
    async setMemory(id, memory) {
      record('setMemory', id, memory);
      const talk = need(id);
      talk.memory = { facts: [...memory.facts], summary: memory.summary };
      return cloneTalk(talk);
    },
    async remove(id) {
      record('remove', id);
      talks.delete(id);
    },
  };
}
