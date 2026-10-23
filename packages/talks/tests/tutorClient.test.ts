import { describe, expect, it, vi } from 'vitest';
import { createFakeGrind } from '../../testing/src/talks.js';
import { createMemoryStore, createTutorClient, defineRegistry, type Command, type Fact, type TalkRequest, type TutorRequest } from '../src/index.js';

const bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).length;

/** A clock that moves 1000 ms each time it is read. */
function clock(start = 1_000_000) {
  let t = start - 1000;
  return () => (t += 1000);
}

const fact = (name: string, value: unknown, more: Partial<Fact> = {}): Fact => ({ name, tell: `what ${name} holds now, in one line`, read: vi.fn(async () => value), ...more });

function setup({ screen = 'drill', budgetBytes, script = [] as unknown[], buildRequest }: { screen?: string; budgetBytes?: number; script?: unknown[]; buildRequest?: (input: { message: string }) => Record<string, unknown> } = {}) {
  const facts = {
    today: fact('today', { day: 'Thursday' }, { core: true }),
    where: fact('where', 'the drill screen', { core: true }),
    plan: fact('plan', { words: ['logos', 'agape'] }),
    rusty: fact('rusty', ['charis']),
    progress: fact('progress', { solid: 120 }),
    broken: fact('broken', null, { read: vi.fn(async () => Promise.reject(new Error('no database'))) }),
  };
  const runs = { mark: vi.fn(async () => ({ said: 'Marked done.' })), undoTheme: vi.fn(async () => undefined), reset: vi.fn(async () => ({ said: 'Progress reset.' })) };
  const setTheme = vi.fn(async (args: unknown) => ({ said: `Theme: ${(args as { theme: string }).theme}`, undo: runs.undoTheme }));
  const commands: Command[] = [
    { name: 'markDone', tell: 'marks today done', kind: 'free', run: runs.mark },
    { name: 'setTheme', tell: 'changes the theme', kind: 'undoable', args: { type: 'object', properties: { theme: { enum: ['dark', 'light'] } }, required: ['theme'] }, run: setTheme },
    { name: 'resetProgress', tell: 'forgets his progress', kind: 'confirm', offer: () => 'Reset all your progress?', run: runs.reset },
    { name: 'explode', tell: 'always fails', kind: 'free', run: async () => Promise.reject(new Error('boom')) },
  ];
  const open = vi.fn(async () => undefined);
  const places = [{ name: 'chapter', tell: 'opens a chapter', args: { type: 'object' as const, properties: { chapter: { type: 'integer' as const } }, required: ['chapter'] }, open }];
  const registry = defineRegistry({ facts: Object.values(facts), commands, places });
  const store = createMemoryStore({ newId: () => 'talk-1' });
  const grind = createFakeGrind<TutorRequest<object>, unknown>(script);
  const onGo = vi.fn();
  const now = clock();
  const client = createTutorClient({ store, send: grind.send, registry, screen: () => screen, budgetBytes, onGo, now, ...(buildRequest ? { buildRequest } : {}) });
  return { facts, runs, setTheme, open, registry, store, grind, onGo, client };
}

describe('the request', () => {
  it("reads every core fact and every fact on the screen's up-front list, with the catalogue and the app's fields as they are", async () => {
    const { client, store, facts, registry } = setup();
    await store.setUpFront('drill', ['plan', 'nothing-by-that-name']);
    const request = await client.buildRequest(0, { message: 'what now?', level: 3, history: [{ role: 'user', text: 'hi' }] });
    expect(request.facts).toEqual({ today: { day: 'Thursday' }, where: 'the drill screen', plan: { words: ['logos', 'agape'] } });
    expect(Object.keys(request.facts)).toEqual(['today', 'where', 'plan']);
    expect(request.catalogue).toEqual(registry.catalogue());
    expect(request).toMatchObject({ message: 'what now?', level: 3, history: [{ role: 'user', text: 'hi' }] });
    expect(request).not.toHaveProperty('asked');
    expect(facts.rusty.read).not.toHaveBeenCalled();
    expect(facts.progress.read).not.toHaveBeenCalled();
  });

  it('an empty up-front list means the core facts only', async () => {
    const { client, store } = setup({ screen: 'home' });
    await store.setUpFront('drill', ['plan']);
    expect(Object.keys((await client.buildRequest(0, { message: 'hi' })).facts)).toEqual(['today', 'where']);
  });

  it('a fact whose read fails is left out and recorded as a miss', async () => {
    const { client, store } = setup();
    await store.setUpFront('drill', ['broken', 'plan']);
    const request = await client.buildRequest(4, { message: 'hi' });
    expect(Object.keys(request.facts)).toEqual(['today', 'where', 'plan']);
    expect(await store.record()).toEqual([{ at: expect.any(Number), screen: 'drill', kind: 'miss', name: 'broken', turn: 4, why: 'broken could not be read: no database' }]);
  });

  it('over budgetBytes: the tell lines of the non-core entries go first, then the newest non-core facts; the core facts and the app fields never', async () => {
    const appFields = { message: 'what now?', note: 'n'.repeat(400) };
    const full = await (async () => {
      const { client, store } = setup();
      await store.setUpFront('drill', ['plan', 'rusty', 'progress']);
      return client.buildRequest(0, appFields);
    })();
    const coreTells = full.catalogue.filter((e) => e.core).map((e) => e.tell);
    expect(coreTells).toHaveLength(2);
    const at = async (budgetBytes: number) => {
      const { client, store } = setup({ budgetBytes });
      await store.setUpFront('drill', ['plan', 'rusty', 'progress']);
      const request = await client.buildRequest(0, appFields);
      expect(request).toMatchObject(appFields);
      expect(request.catalogue.map((e) => e.name)).toEqual(full.catalogue.map((e) => e.name));
      expect(request.catalogue.filter((e) => e.core).map((e) => e.tell)).toEqual(coreTells);
      return request;
    };

    expect(await at(bytes(full))).toEqual(full);

    // one byte over: the last non-core tell line in the catalogue goes, and no fact
    const oneOver = await at(bytes(full) - 1);
    const lastNonCore = [...full.catalogue].reverse().find((e) => !e.core)!.name;
    expect(oneOver.catalogue.filter((e) => e.tell === undefined).map((e) => e.name)).toEqual([lastNonCore]);
    expect(oneOver.facts).toEqual(full.facts);

    // every non-core tell line gone and still too big: the newest non-core fact goes (progress), and no more than must
    const noTells = { ...full, catalogue: full.catalogue.map((e) => (e.core ? e : { ...e, tell: undefined })) };
    const tight = await at(bytes(noTells) - 1);
    expect(tight.catalogue.filter((e) => !e.core).every((e) => e.tell === undefined)).toBe(true);
    expect(Object.keys(tight.facts)).toEqual(['today', 'where', 'plan', 'rusty']);
    expect(bytes(tight)).toBeLessThanOrEqual(bytes(noTells) - 1);

    // far too small: what is left is the app's fields, the core facts and the catalogue's names; nothing of the app's is cut
    const tiny = await at(10);
    expect(Object.keys(tiny.facts)).toEqual(['today', 'where']);
    expect(tiny.note).toBe(appFields.note);
  });

  it("ask sends the app's fields: the default request unless it builds its own", async () => {
    const plain = setup({ script: ['first answer'] });
    const talk = await plain.client.start();
    await plain.client.ask(talk.id, 'hello');
    const sent = plain.grind.calls[0].request as unknown as TutorRequest<TalkRequest>;
    expect(sent).toMatchObject({ message: 'hello', history: [] });
    expect(Object.keys(sent.facts)).toEqual(['today', 'where']);

    const own = setup({ script: ['first answer'], buildRequest: (input) => ({ question: input.message, level: 3 }) });
    await own.client.ask((await own.client.start()).id, 'hello');
    expect(own.grind.calls[0].request).toMatchObject({ question: 'hello', level: 3 });
    expect(own.grind.calls[0].request).not.toHaveProperty('message');
  });
});

describe('asks: a follow-up round', () => {
  it('reads what was asked, sends it back through the same talk as asked, and the second answer is the one kept and returned', async () => {
    const second = { text: 'Your plan today is logos and agape.' };
    const { client, grind, store } = setup({ script: [{ text: 'Let me look.', asks: ['plan', 'rusty', 'lottery numbers'] }, second] });
    const talk = await client.start();
    const turn = await client.ask(talk.id, 'what is my plan?');

    expect(grind.calls).toHaveLength(2);
    expect(grind.calls[0].request).not.toHaveProperty('asked');
    expect(grind.calls[1].request.asked).toEqual({ plan: { words: ['logos', 'agape'] }, rusty: ['charis'] });
    expect(grind.calls[1].request).toMatchObject({ message: 'what is my plan?', facts: grind.calls[0].request.facts });
    expect(turn.answer).toBe(second);
    expect(turn.rounds).toBe(2);
    expect(turn.asked).toEqual({ plan: { words: ['logos', 'agape'] }, rusty: ['charis'] });
    expect((await store.get(talk.id))!.turns.map((t) => t.text)).toEqual(['what is my plan?', 'Your plan today is logos and agape.']);

    const record = await store.record('drill');
    expect(record.map(({ kind, name, turn: n, screen }) => ({ kind, name, turn: n, screen }))).toEqual([
      { kind: 'ask', name: 'plan', turn: 0, screen: 'drill' },
      { kind: 'ask', name: 'rusty', turn: 0, screen: 'drill' },
      { kind: 'miss', name: 'lottery numbers', turn: 0, screen: 'drill' },
    ]);
    expect(record[2].why).toMatch(/no fact called "lottery numbers"/);
    expect(turn.records).toEqual(record);
  });

  it('stops after two rounds: the second answer stands even when it asks again', async () => {
    const { client, grind, store } = setup({ script: [{ text: 'Let me look.', asks: ['plan'] }, { text: 'Here it is.', asks: ['rusty'] }, 'never sent'] });
    const talk = await client.start();
    const turn = await client.ask(talk.id, 'plan?');
    expect(grind.calls).toHaveLength(2);
    expect(turn.answer).toEqual({ text: 'Here it is.', asks: ['rusty'] });
    expect(turn.rounds).toBe(2);
    expect((await store.record()).map((r) => [r.kind, r.name])).toEqual([
      ['ask', 'plan'],
      ['miss', 'rusty'],
    ]);
  });

  it('the turn number is where his turn sits in the talk', async () => {
    const { client, store } = setup({ script: ['one', { text: 'Looking.', asks: ['plan'] }, 'two'] });
    const talk = await client.start();
    await client.ask(talk.id, 'first');
    await client.ask(talk.id, 'second');
    expect((await store.record()).map((r) => r.turn)).toEqual([2]);
  });

  it('a grind that fails in the follow-up keeps nothing, as any failed ask', async () => {
    const { client, store } = setup({ script: [{ text: 'Looking.', asks: ['plan'] }, new Error('the grind is down')] });
    const talk = await client.start();
    await expect(client.ask(talk.id, 'plan?')).rejects.toThrow('the grind is down');
    expect((await store.get(talk.id))!.turns).toEqual([]);
  });
});

describe('do and go', () => {
  it('runs a free command at once, an undoable one with its undo handed over, and leaves a confirm one for the app to confirm', async () => {
    const answer = {
      text: 'Done.',
      do: [{ name: 'markDone' }, { name: 'setTheme', args: { theme: 'dark' } }, { name: 'resetProgress' }],
    };
    const { client, runs, setTheme } = setup({ script: [answer] });
    const turn = await client.ask((await client.start()).id, 'mark it and go dark');

    expect(runs.mark).toHaveBeenCalledTimes(1);
    expect(setTheme).toHaveBeenCalledWith({ theme: 'dark' });
    expect(turn.done).toEqual([
      { name: 'markDone', kind: 'free', said: 'Marked done.' },
      { name: 'setTheme', kind: 'undoable', said: 'Theme: dark', undo: runs.undoTheme },
    ]);
    await turn.done[1].undo!();
    expect(runs.undoTheme).toHaveBeenCalledTimes(1);

    expect(runs.reset).not.toHaveBeenCalled();
    expect(turn.pending).toEqual([{ name: 'resetProgress', said: 'Reset all your progress?', confirm: expect.any(Function) }]);
    expect(await turn.pending[0].confirm()).toEqual({ name: 'resetProgress', kind: 'confirm', said: 'Progress reset.' });
    await turn.pending[0].confirm();
    expect(runs.reset).toHaveBeenCalledTimes(1);
  });

  it('a go opens the place and tells the app, so it can push a history entry', async () => {
    const { client, open, onGo } = setup({ script: [{ text: 'Opening John 3.', go: { name: 'chapter', args: { chapter: 3 } } }] });
    const turn = await client.ask((await client.start()).id, 'take me to John 3');
    expect(open).toHaveBeenCalledWith({ chapter: 3 });
    expect(onGo).toHaveBeenCalledWith({ name: 'chapter', args: { chapter: 3 } });
    expect(turn.went).toEqual({ name: 'chapter', args: { chapter: 3 } });
  });

  it('unknown names, refused args and failed runs are misses, never thrown', async () => {
    const answer = {
      text: 'Trying.',
      do: [{ name: 'fly' }, { name: 'setTheme', args: { theme: 'pink' } }, { name: 'explode' }, { name: 'resetProgress', args: { all: true } }, 'markDone'],
      go: { name: 'chapter', args: { chapter: 'three' } },
      misses: [{ wanted: 'his verse of the day', why: 'no fact holds it' }],
    };
    const { client, open, onGo, setTheme, store } = setup({ script: [answer] });
    const turn = await client.ask((await client.start()).id, 'do it all');
    expect(turn.done).toEqual([]);
    expect(turn.pending).toEqual([]);
    expect(turn.went).toBeUndefined();
    expect(setTheme).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(onGo).not.toHaveBeenCalled();
    const misses = (await store.record()).map((r) => [r.kind, r.name, r.why]);
    expect(misses).toEqual([
      ['miss', 'fly', 'there is no command called "fly"'],
      ['miss', 'setTheme', 'args.theme must be one of "dark", "light"'],
      ['miss', 'explode', 'explode failed: boom'],
      ['miss', 'resetProgress', 'resetProgress takes no args'],
      ['miss', '', 'a do that is not {name, args}'],
      ['miss', 'chapter', 'args.chapter must be an integer'],
      ['miss', 'his verse of the day', 'no fact holds it'],
    ]);
    expect(turn.misses.map((r) => r.name)).toEqual(misses.map((m) => m[1]));
  });

  it('an unknown place is a miss and the app is not told', async () => {
    const { client, onGo, store } = setup({ script: [{ text: 'Going.', go: { name: 'moon' } }] });
    const turn = await client.ask((await client.start()).id, 'take me to the moon');
    expect(onGo).not.toHaveBeenCalled();
    expect(turn.went).toBeUndefined();
    expect((await store.record()).map((r) => r.why)).toEqual(['there is no place called "moon"']);
  });

  it('takeAnswer carries out an answer the app got some other way', async () => {
    const { client, runs, store } = setup();
    const taken = await client.takeAnswer({ do: [{ name: 'markDone' }], misses: [{ wanted: 'x', why: 'y' }] }, 7);
    expect(runs.mark).toHaveBeenCalledTimes(1);
    expect(taken.done).toEqual([{ name: 'markDone', kind: 'free', said: 'Marked done.' }]);
    expect(await store.record()).toEqual([{ at: expect.any(Number), screen: 'drill', kind: 'miss', name: 'x', turn: 7, why: 'y' }]);
  });
});
