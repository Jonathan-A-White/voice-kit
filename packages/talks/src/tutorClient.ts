// tutorClient.ts (mw-t3xu9a.1) — the tutor client: it drives a talk through the app's registry (registry.ts). The Governor's
// words: the tutor should be able to get from the app what it needs for its reply, and to do through the app whatever he wants
// done. Each request carries the facts read up front (the core ones and the screen's up-front list from the store) and the
// catalogue of every fact, command and place, under a byte budget. An answer may ask for facts (`asks`: read and sent back in a
// follow-up round of the same turn, two rounds at most), run commands (`do`), open a place (`go`) and say what it could not
// find (`misses`); the client carries them out and records every ask-back and miss in the store, per screen, for the weights
// a later step tunes. Every other field of the request and the answer is the app's. It knows no app: Lampas and Kestrel bring
// their own registry.
import { isMemoryEmpty } from './memory.js';
import type { CatalogueEntry, CommandKind, Registry } from './registry.js';
import type { TalkStore, TutorRecord, TutorStore } from './store.js';
import { createTalks, type AskOptions, type Asked, type CustomTalksOptions, type OutgoingPicture, type RequestInput, type TalkRequest, type Talks } from './talk.js';

/** How many times one turn goes to the grind: the request, and one follow-up with what was asked. */
export const TUTOR_MAX_ROUNDS = 2;

/** What the client adds to the app's request. `asked` is there only in a follow-up round. */
export interface TutorFields {
  /** Each fact read up front, by name. */
  facts: Record<string, unknown>;
  /** Every fact, command and place the tutor may name (registry.catalogue()), tell lines cut first when the request is too big. */
  catalogue: CatalogueEntry[];
  /** The facts the answer asked for, by name, as read. */
  asked?: Record<string, unknown>;
}

/** A request the grind gets: the app's own fields and the client's. */
export type TutorRequest<Fields extends object = TalkRequest> = Fields & TutorFields;

/** The answer fields the client reads; any other field of an answer is the app's. */
export interface TutorAnswerFields {
  /** Facts it wants before it answers, by name. */
  asks?: string[];
  /** Commands to run, in order. */
  do?: { name: string; args?: unknown }[];
  /** The place to open. */
  go?: { name: string; args?: unknown };
  /** What it wanted that the app has no fact, command or place for. */
  misses?: { wanted: string; why: string }[];
}

/** A command that ran: its said line, and for an undoable one the undo the app offers. */
export interface Done {
  name: string;
  kind: CommandKind;
  said: string;
  undo?: () => Promise<void>;
}

/** A confirm command, not run: the app shows `said` and calls confirm() when he says yes (it runs once; a failure rejects). */
export interface Pending {
  name: string;
  said: string;
  confirm(): Promise<Done>;
}

/** The place that was opened. */
export interface Went {
  name: string;
  args: unknown;
}

/** What the client made of an answer's `do`, `go` and `misses`. */
export interface Taken {
  done: Done[];
  pending: Pending[];
  went?: Went;
  /** Every miss of the turn, as recorded. */
  misses: TutorRecord[];
}

export interface TutorAsked<Answer> extends Asked<Answer>, Taken {
  /** 2 when the answer asked for facts and the follow-up's answer is the one kept. */
  rounds: 1 | 2;
  /** What was sent back in the follow-up, by name: empty in a turn of one round. */
  asked: Record<string, unknown>;
  /** The screen the turn was taken on. */
  screen: string;
  /** Everything recorded in the turn, in order: the ask-backs and the misses. */
  records: TutorRecord[];
}

/** The createTalks options the client passes through (the request and the send are its own). */
export type TutorTalksOptions<Answer> = Omit<CustomTalksOptions<unknown, Answer>, 'store' | 'send' | 'buildRequest' | 'now'>;

export interface TutorClientOptions<Answer, Fields extends object> {
  /** Keeps the talks, the tutor record and the up-front lists: createMemoryStore(), the Dexie store, the fake. */
  store: TalkStore & TutorStore;
  /** The grind: gets the request (the app's fields and the client's) and the files, and answers. */
  send: (request: TutorRequest<Fields>, files: OutgoingPicture[]) => Promise<Answer>;
  registry: Registry;
  /** Where he is in the app now: the key of the up-front list and of the record. */
  screen: () => string;
  /** The most bytes a request may weigh as JSON: non-core tell lines are cut, then the newest non-core facts. No limit unless given. */
  budgetBytes?: number;
  /** The app's own fields of a request; the default request ({ message, history, memory?, pictures? }) unless given. */
  buildRequest?: (input: RequestInput) => Fields;
  /** Told after a `go` has opened its place, so the app can push a history entry. */
  onGo?: (went: Went) => void;
  /** The clock: Date.now unless given. */
  now?: () => number;
  /** answerText, maxHistory, readMemory and the rest, as createTalks takes them. */
  talks?: TutorTalksOptions<Answer>;
}

export interface TutorClient<Answer> {
  start: Talks<Answer>['start'];
  /**
   * Takes one turn of the talk: builds the request, sends it, and when the answer asks for facts reads them and sends a
   * follow-up (two rounds at most: the second answer stands even if it asks again). The answer that stands is kept and its
   * `do`, `go` and `misses` carried out; a refused call is a miss, never thrown. A failure of the grind keeps nothing.
   */
  ask(id: string, message: string, options?: AskOptions): Promise<TutorAsked<Answer>>;
  remember: Talks<Answer>['remember'];
  search: Talks<Answer>['search'];
  /** The request for the app's `fields` on the screen now: the facts read up front and the catalogue, fitted to the budget. */
  buildRequest<F extends object>(turn: number, fields: F): Promise<TutorRequest<F>>;
  /** Carries out an answer's `do`, `go` and `misses` (not its `asks`: they are a round of `ask`) and records the misses. */
  takeAnswer(answer: unknown, turn: number): Promise<Taken>;
}

/** What the client knows of the turn being taken. */
interface TurnNotes {
  screen: string;
  turn: number;
  records: TutorRecord[];
}

const sizeOf = (request: unknown): number => new TextEncoder().encode(JSON.stringify(request)).length;
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const field = (answer: unknown, key: keyof TutorAnswerFields): unknown => (isObject(answer) ? answer[key] : undefined);
const asksOf = (answer: unknown): string[] => {
  const asks = field(answer, 'asks');
  return Array.isArray(asks) ? [...new Set(asks.filter((name): name is string => typeof name === 'string'))] : [];
};

/** The default request's fields, as createTalks makes them. */
const defaultFields = (input: RequestInput): TalkRequest => ({
  message: input.message,
  history: input.turns.map(({ role, text }) => ({ role, text })),
  ...(isMemoryEmpty(input.memory) ? {} : { memory: input.memory }),
  ...(input.pictures.length > 0 ? { pictures: input.pictures.length } : {}),
});

/**
 * Makes the request fit `budget`: while it is too big the tell line of the last non-core catalogue entry still holding one is
 * cut, then the newest non-core fact (the last read) is dropped; its name stays in the catalogue, so it can be asked for. The
 * app's fields and the core facts are never cut.
 */
function fit<F extends object>(fields: F, facts: [string, unknown][], core: ReadonlySet<string>, catalogue: CatalogueEntry[], budget: number | undefined): TutorRequest<F> {
  const make = (): TutorRequest<F> => ({ ...fields, facts: Object.fromEntries(facts), catalogue });
  if (budget === undefined) return make();
  for (let at = catalogue.length - 1; at >= 0 && sizeOf(make()) > budget; at--) {
    const entry = catalogue[at];
    if (!entry.core) {
      const rest = { ...entry };
      delete rest.tell;
      catalogue[at] = rest;
    }
  }
  for (let at = facts.length - 1; at >= 0 && sizeOf(make()) > budget; at--) {
    if (!core.has(facts[at][0])) facts.splice(at, 1);
  }
  return make();
}

export function createTutorClient<Answer = string, Fields extends object = TalkRequest>(options: TutorClientOptions<Answer, Fields>): TutorClient<Answer> {
  const { store, send, registry, screen, budgetBytes, onGo, now = Date.now } = options;
  const appFields = options.buildRequest ?? (defaultFields as unknown as (input: RequestInput) => Fields);
  // the turn being taken on each talk; a talk's turns are taken one at a time, so its send finds its own
  const taking = new Map<string, TurnNotes & { rounds: 1 | 2; asked: Record<string, unknown> }>();
  const queues = new Map<string, Promise<unknown>>();

  const note = (notes: TurnNotes, kind: TutorRecord['kind'], name: string, why?: string): void => {
    notes.records.push({ at: now(), screen: notes.screen, kind, name, turn: notes.turn, ...(why === undefined ? {} : { why }) });
  };

  async function request<F extends object>(notes: TurnNotes, fields: F): Promise<TutorRequest<F>> {
    const core = new Set(registry.facts.filter((f) => f.core).map((f) => f.name));
    const upFront = (await store.upFront(notes.screen)).filter((name) => registry.fact(name) && !core.has(name));
    const names = [...new Set([...core, ...upFront])];
    const facts: [string, unknown][] = [];
    for (const [name, read] of await Promise.all(names.map(async (name) => [name, await registry.read(name)] as const))) {
      if (read.ok) facts.push([name, read.value]);
      else note(notes, 'miss', name, read.why);
    }
    return fit(fields, facts, core, registry.catalogue(), budgetBytes);
  }

  function pendingOf(name: string, said: string, args: unknown): Pending {
    let running: Promise<Done> | undefined;
    const run = async (): Promise<Done> => {
      const ran = await registry.run(name, args);
      if (!ran.ok) throw new Error(ran.why);
      return { name, kind: 'confirm', said: ran.said, ...(ran.undo ? { undo: ran.undo } : {}) };
    };
    return {
      name,
      said,
      confirm: () =>
        (running ??= run().catch((error: unknown) => {
          running = undefined;
          throw error;
        })),
    };
  }

  async function carryOut(answer: unknown, notes: TurnNotes): Promise<Taken> {
    const done: Done[] = [];
    const pending: Pending[] = [];
    let went: Went | undefined;
    const dos = field(answer, 'do');
    for (const item of Array.isArray(dos) ? dos : []) {
      if (!isObject(item) || typeof item.name !== 'string') {
        note(notes, 'miss', '', 'a do that is not {name, args}');
        continue;
      }
      const { name, args } = item;
      const command = registry.command(name);
      if (command?.kind === 'confirm') {
        const why = registry.refuses(name, args);
        if (why) note(notes, 'miss', name, why);
        else pending.push(pendingOf(name, command.offer?.(args ?? {}) ?? command.tell, args));
        continue;
      }
      const ran = await registry.run(name, args);
      if (!ran.ok) note(notes, 'miss', name, ran.why);
      else done.push({ name, kind: command!.kind, said: ran.said, ...(command!.kind === 'undoable' && ran.undo ? { undo: ran.undo } : {}) });
    }
    const go = field(answer, 'go');
    if (go !== undefined && go !== null) {
      if (!isObject(go) || typeof go.name !== 'string') note(notes, 'miss', '', 'a go that is not {name, args}');
      else {
        const opened = await registry.open(go.name, go.args);
        if (opened.ok) {
          went = { name: go.name, args: go.args ?? {} };
          onGo?.(went);
        } else note(notes, 'miss', go.name, opened.why);
      }
    }
    const misses = field(answer, 'misses');
    for (const miss of Array.isArray(misses) ? misses : []) {
      if (isObject(miss) && typeof miss.wanted === 'string') note(notes, 'miss', miss.wanted, typeof miss.why === 'string' ? miss.why : '');
    }
    return { done, pending, ...(went ? { went } : {}), misses: notes.records.filter((r) => r.kind === 'miss') };
  }

  const talks = createTalks<{ input: RequestInput }, Answer>({
    ...options.talks,
    store,
    now,
    buildRequest: (input) => ({ input }),
    async send({ input }, files) {
      const notes = taking.get(input.talk.id) ?? { screen: screen(), turn: 0, records: [], rounds: 1, asked: {} };
      notes.turn = input.talk.turns.length;
      const first = await request(notes, appFields(input));
      const answer = await send(first, files);
      const asks = asksOf(answer);
      if (asks.length === 0) return answer;
      for (const [name, read] of await Promise.all(asks.map(async (name) => [name, await registry.read(name)] as const))) {
        if (read.ok) {
          notes.asked[name] = read.value;
          note(notes, 'ask', name);
        } else note(notes, 'miss', name, read.why);
      }
      notes.rounds = 2;
      const second = await send({ ...first, asked: notes.asked }, files);
      for (const name of asksOf(second)) note(notes, 'miss', name, `asked for after the follow-up: a turn has ${TUTOR_MAX_ROUNDS} rounds`);
      return second;
    },
  });

  async function take(id: string, message: string, askOptions: AskOptions): Promise<TutorAsked<Answer>> {
    const notes = { screen: screen(), turn: 0, records: [] as TutorRecord[], rounds: 1 as 1 | 2, asked: {} as Record<string, unknown> };
    taking.set(id, notes);
    try {
      const asked = await talks.ask(id, message, askOptions);
      const taken = await carryOut(asked.answer, notes);
      await store.note(notes.records);
      return { ...asked, ...taken, rounds: notes.rounds, asked: notes.asked, screen: notes.screen, records: notes.records };
    } finally {
      taking.delete(id);
    }
  }

  function queued<T>(id: string, task: () => Promise<T>): Promise<T> {
    const result = (queues.get(id) ?? Promise.resolve()).then(task);
    const tail = result.catch(() => undefined);
    queues.set(id, tail);
    void tail.then(() => {
      if (queues.get(id) === tail) queues.delete(id);
    });
    return result;
  }

  return {
    start: talks.start,
    ask: (id, message, askOptions = {}) => queued(id, () => take(id, message, askOptions)),
    remember: talks.remember,
    search: talks.search,
    async buildRequest(turn, fields) {
      const notes: TurnNotes = { screen: screen(), turn, records: [] };
      const built = await request(notes, fields);
      await store.note(notes.records);
      return built;
    },
    async takeAnswer(answer, turn) {
      const notes: TurnNotes = { screen: screen(), turn, records: [] };
      const taken = await carryOut(answer, notes);
      await store.note(notes.records);
      return taken;
    },
  };
}
