import { describe, expect, it, vi } from 'vitest';
import { createFakeGrind } from '../../testing/src/talks.js';
import { createMemoryStore, createTutorClient, defineRegistry, type Fact, type TutorRecord, type TutorRequest } from '../src/index.js';

const fact = (name: string, value: unknown, more: Partial<Fact> = {}): Fact => ({ name, tell: `what ${name} holds`, read: vi.fn(async () => value), ...more });

const DAY = 86_400_000;
const T0 = 1_000_000_000_000;

/** The record of `turns` turns on `screen`, one a minute from `from`: each a 'turn' line, then the ask-backs `asks[i]` names of turn i. */
function turns(screen: string, count: number, asks: Record<number, string[]> = {}, from = T0): TutorRecord[] {
  const out: TutorRecord[] = [];
  for (let i = 0; i < count; i++) {
    const at = from + i * 60_000;
    out.push({ at, screen, kind: 'turn', name: '', turn: i });
    for (const name of asks[i] ?? []) out.push({ at, screen, kind: 'ask', name, turn: i });
  }
  return out;
}

function setup(learn?: { askBacks?: number; turns?: number }, now = () => T0 + 10 * DAY, script: unknown[] = ['an answer']) {
  const registry = defineRegistry({
    facts: [
      fact('today', 'Thursday', { core: true }),
      fact('today-drill', ['logos']),
      fact('works', ['agape']),
      fact('plan', { words: 3 }),
    ],
    commands: [],
    places: [],
  });
  const store = createMemoryStore({ newId: () => 'talk-1' });
  const grind = createFakeGrind<TutorRequest<object>, unknown>(script);
  const client = createTutorClient({ store, send: grind.send, registry, screen: () => 'reader', now, ...(learn ? { learn } : {}) });
  return { store, client, grind, registry };
}

describe('upFront: core + what was asked back there often lately', () => {
  it("60 turns on 'reader', today-drill asked back 3 times and works once: the list holds core and today-drill, not works", async () => {
    const { store, client } = setup();
    await store.note(turns('reader', 60, { 15: ['today-drill'], 30: ['works', 'today-drill'], 55: ['today-drill'] }));
    expect(await client.upFront('reader')).toEqual(['today', 'today-drill']);
  });

  it('a screen nothing was asked back on has the core facts only', async () => {
    const { store, client } = setup();
    await store.note(turns('reader', 60, { 15: ['today-drill'], 6: ['today-drill'] }));
    expect(await client.upFront('home')).toEqual(['today']);
  });

  it('the most asked-back comes first, and a name that is no fact (or is core) is not carried', async () => {
    const { store, client } = setup();
    await store.note(turns('reader', 10, { 1: ['works', 'plan', 'ghost', 'today'], 2: ['plan', 'works', 'ghost', 'today'], 3: ['plan', 'ghost', 'today'] }));
    expect(await client.upFront('reader')).toEqual(['today', 'plan', 'works']);
  });

  it('M is settable: asks older than the last M turns do not count', async () => {
    const records = turns('reader', 60, { 15: ['today-drill'], 30: ['today-drill'], 55: ['today-drill'] });
    const fifty = setup();
    await fifty.store.note(records);
    expect(await fifty.client.upFront('reader')).toEqual(['today', 'today-drill']);
    const ten = setup({ turns: 10 });
    await ten.store.note(records);
    expect(await ten.client.upFront('reader')).toEqual(['today']);
    const thirty = setup({ turns: 30 });
    await thirty.store.note(records);
    // turns 30..59 are the last thirty: asks at 30 and 55
    expect(await thirty.client.upFront('reader')).toEqual(['today', 'today-drill']);
    const twentyNine = setup({ turns: 29 });
    await twentyNine.store.note(records);
    expect(await twentyNine.client.upFront('reader')).toEqual(['today']);
  });

  it('N is settable: how many ask-backs a name needs', async () => {
    const records = turns('reader', 60, { 15: ['today-drill', 'works'], 30: ['today-drill'], 55: ['today-drill'] });
    const one = setup({ askBacks: 1 });
    await one.store.note(records);
    expect(await one.client.upFront('reader')).toEqual(['today', 'today-drill', 'works']);
    const three = setup({ askBacks: 3 });
    await three.store.note(records);
    expect(await three.client.upFront('reader')).toEqual(['today', 'today-drill']);
    const four = setup({ askBacks: 4 });
    await four.store.note(records);
    expect(await four.client.upFront('reader')).toEqual(['today']);
  });

  it("only that screen's turns and ask-backs count", async () => {
    const { store, client } = setup();
    await store.note([...turns('home', 60, { 20: ['plan'], 21: ['plan'] }), ...turns('reader', 60, { 20: ['works'] })]);
    expect(await client.upFront('reader')).toEqual(['today']);
    expect(await client.upFront('home')).toEqual(['today', 'plan']);
  });

  it('the client records a turn line for each ask() and buildRequest(), so a turn without an ask-back counts', async () => {
    const { store, client } = setup();
    const talk = await client.start();
    await client.ask(talk.id, 'hello');
    await client.buildRequest(1, { message: 'again' });
    expect((await store.record('reader')).filter((r) => r.kind === 'turn')).toHaveLength(2);
    expect((await client.stats('reader')).reader.turns).toBe(2);
  });
});

describe('the request carries the list', () => {
  it('a fact asked back often enough on the screen is read up front in the next request', async () => {
    const { store, client, registry } = setup();
    await store.note(turns('reader', 20, { 3: ['plan'], 9: ['plan'] }));
    const request = await client.buildRequest(20, { message: 'hi' });
    expect(Object.keys(request.facts)).toEqual(['today', 'plan']);
    expect(registry.fact('plan')).toBeDefined();
  });
});

describe('stats', () => {
  it('counts turns, ask-backs and misses per screen and name', async () => {
    const { store, client } = setup();
    await store.note([
      ...turns('reader', 4, { 1: ['works'], 2: ['works', 'plan'] }),
      { at: T0, screen: 'reader', kind: 'miss', name: 'fly', turn: 1, why: 'no command' },
      { at: T0 + 1, screen: 'reader', kind: 'miss', name: 'fly', turn: 2, why: 'no command' },
      ...turns('home', 2, { 0: ['plan'] }),
    ]);
    const all = await client.stats();
    expect(Object.keys(all).sort()).toEqual(['home', 'reader']);
    expect(all.reader).toEqual({ turns: 4, askBacks: { works: 2, plan: 1 }, misses: { fly: 2 } });
    expect(all.home).toEqual({ turns: 2, askBacks: { plan: 1 }, misses: {} });
    expect(await client.stats('reader')).toEqual({ reader: all.reader });
    expect(await client.stats('nowhere')).toEqual({});
  });
});

describe('applyWeights', () => {
  it('records the lists with the date and the source; upFront reads the applied list over the counted one', async () => {
    const { store, client } = setup();
    await store.note(turns('reader', 60, { 15: ['today-drill'], 30: ['today-drill'] }));
    expect(await client.upFront('reader')).toEqual(['today', 'today-drill']);
    const applied = await client.applyWeights({ reader: ['works'], home: ['plan'] }, 'grist', T0 + 5 * DAY);
    expect(applied).toEqual([
      { at: T0 + 5 * DAY, screen: 'reader', source: 'grist', names: ['works'], ignored: [] },
      { at: T0 + 5 * DAY, screen: 'home', source: 'grist', names: ['plan'], ignored: [] },
    ]);
    expect(await client.upFront('reader')).toEqual(['today', 'works']);
    expect(await client.upFront('home')).toEqual(['today', 'plan']);
    expect(await store.upFront('reader')).toEqual(['works']);
    const weights = (await store.record('reader')).filter((r) => r.kind === 'weights');
    expect(weights).toEqual([{ at: T0 + 5 * DAY, screen: 'reader', kind: 'weights', name: 'grist', turn: 0, names: ['works'] }]);
  });

  it('an applied list can be empty: the core facts only, whatever was counted', async () => {
    const { store, client } = setup();
    await store.note(turns('reader', 60, { 15: ['today-drill'], 30: ['today-drill'] }));
    await client.applyWeights({ reader: [] }, 'app');
    expect(await client.upFront('reader')).toEqual(['today']);
  });

  it('leaves out names that are no fact, are core, or repeat, and says so', async () => {
    const { client } = setup();
    const [one] = await client.applyWeights({ reader: ['works', 'ghost', 'today', 'works'] }, 'grist', T0);
    expect(one.names).toEqual(['works']);
    expect(one.ignored).toEqual(['ghost', 'today']);
  });

  it('dates the record with the clock when no date is given', async () => {
    const { client, store } = setup(undefined, () => 42);
    await client.applyWeights({ reader: ['works'] }, 'app');
    expect((await store.record('reader'))[0]).toMatchObject({ kind: 'weights', at: 42, name: 'app' });
  });

  it('a later apply replaces the earlier one', async () => {
    const { client } = setup();
    await client.applyWeights({ reader: ['works'] }, 'grist', T0);
    await client.applyWeights({ reader: ['plan'] }, 'app', T0 + 1);
    expect(await client.upFront('reader')).toEqual(['today', 'plan']);
  });
});

describe('rate: ask-backs per 100 turns', () => {
  it('rate(screen, since) counts the turns and ask-backs from since on', async () => {
    const { store, client } = setup();
    // turns at T0 + i minutes; 20 turns, 5 ask-backs in the first ten, 1 in the second ten
    await store.note(turns('reader', 20, { 0: ['works'], 2: ['works'], 4: ['plan'], 6: ['plan'], 8: ['works'], 15: ['works'] }));
    expect(await client.rate('reader', T0)).toBe(30);
    expect(await client.rate('reader', T0 + 10 * 60_000)).toBe(10);
    expect(await client.rate('reader', T0, T0 + 10 * 60_000)).toBe(50);
    expect(await client.rate('reader', T0 + DAY)).toBeUndefined();
    expect(await client.rate('home', 0)).toBeUndefined();
  });

  it('shows the rate before and after an applyWeights at a date', async () => {
    const { store, client } = setup();
    const change = T0 + 100 * 60_000;
    await store.note([
      // before: 100 turns, 20 ask-backs
      ...turns('reader', 100, Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i * 5, ['works']]))),
      // after: 50 turns, 2 ask-backs
      ...turns('reader', 50, { 10: ['works'], 40: ['plan'] }, change),
    ]);
    expect(await client.change('reader')).toBeUndefined();
    await client.applyWeights({ reader: ['works'] }, 'grist', change);
    const seen = (await client.change('reader'))!;
    expect(seen).toEqual({ at: change, source: 'grist', before: 20, after: 4 });
    expect(await client.rate('reader', 0, change)).toBe(20);
    expect(await client.rate('reader', change)).toBe(4);
  });

  it("the 'before' of a second change is the time under the first, not all of the past", async () => {
    const { store, client } = setup();
    const first = T0 + 10 * 60_000;
    const second = T0 + 20 * 60_000;
    await store.note(turns('reader', 30, { 1: ['works'], 12: ['works'], 14: ['works'], 25: ['plan'] }));
    await client.applyWeights({ reader: ['works'] }, 'grist', first);
    await client.applyWeights({ reader: ['plan'] }, 'grist', second);
    expect(await client.change('reader')).toEqual({ at: second, source: 'grist', before: 20, after: 10 });
  });
});

describe('weightsReport', () => {
  async function seeded() {
    const made = setup();
    await made.store.note([
      ...turns('reader', 60, { 15: ['today-drill'], 30: ['today-drill', 'works'], 55: ['today-drill'] }),
      { at: T0 + 50 * 60_000, screen: 'reader', kind: 'miss', name: 'fly', turn: 50, why: 'there is no command called "fly"' },
      { at: T0 + 51 * 60_000, screen: 'reader', kind: 'miss', name: 'fly', turn: 51, why: 'there is no command called "fly"' },
      ...turns('home', 3, { 1: ['plan'] }, T0 + 2 * DAY),
    ]);
    return made;
  }

  it('carries the counts by screen and name, the misses, the current lists and the rates', async () => {
    const { client } = await seeded();
    const report = await client.weightsReport(0);
    expect(report.changed).toBe(true);
    expect(report.since).toBe(0);
    expect(report.at).toBe(T0 + 10 * DAY);
    expect(report.screens.reader).toMatchObject({
      turns: 60,
      counts: { 'today-drill': 3, works: 1 },
      upFront: ['today', 'today-drill'],
      rate: { overall: (4 / 60) * 100 },
    });
    expect(report.screens.reader.applied).toBeUndefined();
    expect(report.screens.home).toMatchObject({ turns: 3, counts: { plan: 1 }, upFront: ['today'] });
    expect(report.misses).toEqual([{ screen: 'reader', name: 'fly', count: 2, why: 'there is no command called "fly"' }]);
  });

  it('after an applyWeights it names the applied list and the rates before and after', async () => {
    const { client } = await seeded();
    const at = T0 + 40 * 60_000;
    await client.applyWeights({ reader: ['works'] }, 'grist', at);
    const report = await client.weightsReport(0);
    expect(report.screens.reader.upFront).toEqual(['today', 'works']);
    expect(report.screens.reader.applied).toEqual({ at, source: 'grist', names: ['works'] });
    expect(report.screens.reader.rate).toEqual({ overall: (4 / 60) * 100, before: (3 / 40) * 100, after: (1 / 20) * 100 });
  });

  it('changed is true when an ask-back, a miss or an applyWeights is newer than since, else false', async () => {
    const { client } = await seeded();
    const latest = T0 + 2 * DAY + 60_000;
    expect((await client.weightsReport(latest)).changed).toBe(false);
    expect((await client.weightsReport(latest - 1)).changed).toBe(true);
    await client.applyWeights({ reader: ['works'] }, 'grist', latest + 5);
    expect((await client.weightsReport(latest)).changed).toBe(true);
    expect((await client.weightsReport(latest + 5)).changed).toBe(false);
  });

  it('with no record at all: changed is false and there are no screens', async () => {
    const { client } = setup();
    expect(await client.weightsReport(0)).toEqual({ since: 0, at: T0 + 10 * DAY, changed: false, screens: {}, misses: [] });
  });

  it('misses are those since `since`, the counts are those of the window', async () => {
    const { client } = await seeded();
    const report = await client.weightsReport(T0 + 50 * 60_000 + 1);
    expect(report.misses).toEqual([{ screen: 'reader', name: 'fly', count: 1, why: 'there is no command called "fly"' }]);
    expect(report.screens.reader.counts).toEqual({ 'today-drill': 3, works: 1 });
  });
});
