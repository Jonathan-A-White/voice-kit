import { describe, expect, it } from 'vitest';
import { createMemoryStore, createTalks, searchTalks } from '../src/index.js';
import { defaultSnippet, foldText, type SearchPlace, type TalkReader } from '../src/index.js';

async function setup() {
  const store = createMemoryStore({ newId: (() => { let n = 0; return () => `talk-${++n}`; })() });
  const talks = createTalks({ store, send: async (request: { message: string }) => `answer to ${request.message}` });
  const romans = await talks.start({ title: 'Romans 8: adoption' });
  for (let i = 1; i <= 10; i++) await talks.ask(romans.id, i === 7 ? 'what is a firstfruit?' : `question ${i}`);
  const grace = await talks.start({ title: 'Grace' });
  await talks.ask(grace.id, 'tell me about Café life');
  return { store, talks, romans, grace };
}

describe('search over titles and turns', () => {
  it('finds a talk by a word in turn 7', async () => {
    const { store, talks, romans } = await setup();
    for (const found of [await searchTalks(store, 'firstfruit'), await talks.search('firstfruit')]) {
      expect(found.map((h) => h.id)).toEqual([romans.id]);
      expect(found[0].matches[0]).toMatchObject({ in: 'turn', turn: 12 });
      expect(found[0].matches[0].snippet).toContain('firstfruit');
    }
  });

  it('finds a talk by a word in its title', async () => {
    const { store, grace } = await setup();
    const found = await searchTalks(store, 'grace');
    expect(found.map((h) => h.id)).toEqual([grace.id]);
    expect(found[0].matches[0]).toMatchObject({ in: 'title', snippet: 'Grace' });
  });

  it('finds none for a word in no talk, and none for an empty query', async () => {
    const { store } = await setup();
    expect(await searchTalks(store, 'zebra')).toEqual([]);
    expect(await searchTalks(store, '   ')).toEqual([]);
  });

  it('ignores case and accents, and wants every word of the query in one place', async () => {
    const { store, grace, romans } = await setup();
    expect((await searchTalks(store, 'CAFE')).map((h) => h.id)).toEqual([grace.id]);
    expect((await searchTalks(store, 'firstfruit question')).map((h) => h.id)).toEqual([]);
    expect((await searchTalks(store, 'what firstfruit')).map((h) => h.id)).toEqual([romans.id]);
  });

  it('puts a title match first, then the talk last added to, and honours the limit', async () => {
    const store = createMemoryStore({ newId: (() => { let n = 0; return () => `t${++n}`; })() });
    const a = await store.create({ title: 'about bread', now: 1 });
    const b = await store.create({ title: 'other', now: 2 });
    const c = await store.create({ title: 'bread again', now: 3 });
    await store.append(b.id, [{ role: 'user', text: 'bread please', at: 10 }]);
    expect((await searchTalks(store, 'bread')).map((h) => h.id)).toEqual([c.id, a.id, b.id]);
    expect((await searchTalks(store, 'bread', { limit: 2 })).map((h) => h.id)).toEqual([c.id, a.id]);
  });

  it('gives a snippet around the match and caps the matches kept per talk', async () => {
    const store = createMemoryStore();
    const t = await store.create({ title: 'x' });
    const long = `${'a '.repeat(100)}needle${' b'.repeat(100)}`;
    await store.append(t.id, Array.from({ length: 5 }, (_, i) => ({ role: 'user' as const, text: long, at: i })));
    const [hit] = await searchTalks(store, 'needle', { maxMatches: 3 });
    expect(hit.matches).toHaveLength(3);
    expect(hit.matchCount).toBe(5);
    expect(hit.matches[0].snippet.length).toBeLessThan(120);
    expect(hit.matches[0].snippet).toContain('needle');
  });
});

describe('a pluggable search', () => {
  async function pairs() {
    const store = createMemoryStore({ newId: (() => { let n = 0; return () => `p${++n}`; })() });
    const t = await store.create({ title: 'Talk' });
    await store.append(t.id, [
      { role: 'user', text: 'tell me about grace', at: 1 },
      { role: 'assistant', text: 'it is an undeserved gift', at: 2 },
    ]);
    return { store, t };
  }

  it('searches the places `places` gives: a question and its answer as one place', async () => {
    const { store, t } = await pairs();
    expect(await searchTalks(store, 'grace gift')).toEqual([]);
    const pairPlaces = (talk: { turns: { role: 'user' | 'assistant'; text: string }[] }): SearchPlace[] =>
      talk.turns.flatMap((turn, turnIndex) =>
        turn.role === 'user'
          ? [{ in: 'turn' as const, turn: turnIndex, role: turn.role, text: `${turn.text}\n${talk.turns[turnIndex + 1]?.text ?? ''}` }]
          : [],
      );
    const found = await searchTalks(store, 'grace gift', { places: pairPlaces });
    expect(found.map((h) => h.id)).toEqual([t.id]);
    expect(found[0].matches[0]).toMatchObject({ in: 'turn', turn: 0, role: 'user' });
    expect(found[0].matchCount).toBe(1);
  });

  it('folds the query and the texts with `fold`, and exports the default as foldText', async () => {
    const store = createMemoryStore();
    const a = await store.create({ title: 'a' });
    await store.append(a.id, [{ role: 'user', text: 'a quiet cafe', at: 1 }]);
    const b = await store.create({ title: 'b' });
    await store.append(b.id, [{ role: 'user', text: 'a quiet Café', at: 1 }]);
    const lower = (text: string) => text.toLowerCase();
    expect((await searchTalks(store, 'CAFE', { fold: lower })).map((h) => h.id)).toEqual([a.id]);
    expect((await searchTalks(store, 'CAFE')).map((h) => h.id).sort()).toEqual([a.id, b.id].sort());
    expect(foldText('Café')).toBe('cafe');
  });

  it('carries the line `snippet` returns, and exports the default as defaultSnippet', async () => {
    const store = createMemoryStore();
    const t = await store.create({ title: 'x' });
    const text = `first line\nthe needle is on this line, with more words after it\nlast line ${'z'.repeat(200)}`;
    await store.append(t.id, [{ role: 'user', text, at: 1 }]);
    const lineWith = (whole: string, at: number): string => {
      const from = whole.lastIndexOf('\n', at) + 1;
      const to = whole.indexOf('\n', at);
      return whole.slice(from, to < 0 ? undefined : to);
    };
    const [hit] = await searchTalks(store, 'needle', { snippet: lineWith });
    expect(hit.matches[0].snippet).toBe('the needle is on this line, with more words after it');
    const [plain] = await searchTalks(store, 'needle');
    expect(plain.matches[0].snippet).toBe(defaultSnippet(text, text.indexOf('needle'), 'needle'));
    expect(defaultSnippet('a needle b', 2, 'needle')).toBe('a needle b');
  });

  it('keeps every match when maxMatches is Infinity', async () => {
    const store = createMemoryStore();
    const t = await store.create({ title: 'x' });
    await store.append(t.id, Array.from({ length: 5 }, (_, i) => ({ role: 'user' as const, text: 'needle here', at: i })));
    const [hit] = await searchTalks(store, 'needle', { maxMatches: Infinity });
    expect(hit.matches).toHaveLength(5);
    expect(hit.matchCount).toBe(5);
  });

  it('reads through a TalkReader that has only list and get', async () => {
    const { store, t } = await pairs();
    const reader: TalkReader = { list: (options) => store.list(options), get: (id) => store.get(id) };
    expect((await searchTalks(reader, 'grace')).map((h) => h.id)).toEqual([t.id]);
  });
});
