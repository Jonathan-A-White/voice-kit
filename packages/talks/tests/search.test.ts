import { describe, expect, it } from 'vitest';
import { createMemoryStore, createTalks, searchTalks } from '../src/index.js';

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
