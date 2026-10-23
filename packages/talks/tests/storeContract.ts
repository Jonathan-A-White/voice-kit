import { describe, expect, it } from 'vitest';
import type { TalkStore, TutorRecord, TutorStore } from '../src/index.js';

// One contract any TalkStore keeps; store.test.ts runs it over the in-memory store and the fake of @voice-kit/testing, and
// dexieStore.test.ts over the Dexie one. A store the tutor client uses keeps its record and up-front lists too (TutorStore).
export function storeContract(name: string, make: () => TalkStore & TutorStore) {
  describe(`${name}: the TalkStore contract`, () => {
    it('creates a talk with an id, a title, no turns and an empty memory', async () => {
      const store = make();
      const talk = await store.create({ title: 'Romans 8', now: 5 });
      expect(talk).toMatchObject({ title: 'Romans 8', turns: [], memory: { facts: [], summary: '' }, createdAt: 5, updatedAt: 5 });
      expect(talk.id).toBeTruthy();
      expect(await store.get(talk.id)).toEqual(talk);
      expect(await store.get('missing')).toBeUndefined();
    });

    it('appends turns in order and moves updatedAt to the last turn', async () => {
      const store = make();
      const { id } = await store.create({ now: 1 });
      await store.append(id, [{ role: 'user', text: 'a', at: 10 }, { role: 'assistant', text: 'b', at: 11 }]);
      const after = await store.append(id, [{ role: 'user', text: 'c', at: 12 }]);
      expect(after.turns.map((t) => t.text)).toEqual(['a', 'b', 'c']);
      expect(after.updatedAt).toBe(12);
      await expect(store.append('missing', [])).rejects.toThrow();
    });

    it('lists talks, the newest activity first, as summaries', async () => {
      const store = make();
      const a = await store.create({ title: 'A', now: 1 });
      const b = await store.create({ title: 'B', now: 2 });
      await store.append(a.id, [{ role: 'user', text: 'hello there', at: 30 }]);
      expect((await store.list()).map((t) => t.title)).toEqual(['A', 'B']);
      expect((await store.list())[0]).toEqual({ id: a.id, title: 'A', turnCount: 1, firstText: 'hello there', createdAt: 1, updatedAt: 30 });
      expect((await store.list({ limit: 1 })).map((t) => t.id)).toEqual([a.id]);
      expect(b.id).not.toBe(a.id);
    });

    it('renames, keeps a memory, and removes a talk with everything in it', async () => {
      const store = make();
      const { id } = await store.create({ title: 'old' });
      expect((await store.rename(id, 'new')).title).toBe('new');
      expect((await store.setMemory(id, { facts: ['likes Greek'], summary: 's' })).memory).toEqual({ facts: ['likes Greek'], summary: 's' });
      await store.remove(id);
      expect(await store.get(id)).toBeUndefined();
      expect(await store.list()).toEqual([]);
      await store.remove(id);
    });

    it('hands out copies: changing what was read changes nothing kept', async () => {
      const store = make();
      const { id } = await store.create();
      await store.append(id, [{ role: 'user', text: 'a', at: 1, pictures: [{ bytes: new Uint8Array([1, 2]), mime: 'image/png', name: 'p.png' }] }]);
      const read = (await store.get(id))!;
      read.turns[0].text = 'changed';
      read.turns[0].pictures![0].bytes[0] = 99;
      read.memory.facts.push('x');
      const again = (await store.get(id))!;
      expect(again.turns[0].text).toBe('a');
      expect(Array.from(again.turns[0].pictures![0].bytes)).toEqual([1, 2]);
      expect(again.memory.facts).toEqual([]);
    });

    it("keeps a turn's fields as given, by copy", async () => {
      const store = make();
      const { id } = await store.create();
      const given = { cleanQ: 'x', n: 2, nested: { list: [1, 2] } };
      await store.append(id, [{ role: 'user', text: 'a', at: 1, fields: given }, { role: 'assistant', text: 'b', at: 2 }]);
      given.nested.list.push(3);
      const read = (await store.get(id))!;
      expect(read.turns[0].fields).toEqual({ cleanQ: 'x', n: 2, nested: { list: [1, 2] } });
      expect('fields' in read.turns[1]).toBe(false);
      (read.turns[0].fields as typeof given).cleanQ = 'changed';
      (read.turns[0].fields as typeof given).nested.list.push(9);
      expect((await store.get(id))!.turns[0].fields).toEqual({ cleanQ: 'x', n: 2, nested: { list: [1, 2] } });
      const after = await store.append(id, [{ role: 'user', text: 'c', at: 3, fields: { k: 1 } }]);
      expect(after.turns.map((t) => t.fields)).toEqual([{ cleanQ: 'x', n: 2, nested: { list: [1, 2] } }, undefined, { k: 1 }]);
      expect((await store.list())[0]).not.toHaveProperty('fields');
    });

    it('keeps the tutor record, oldest first, all of it or one screen', async () => {
      const store = make();
      expect(await store.record()).toEqual([]);
      const ask: TutorRecord = { at: 10, screen: 'drill', kind: 'ask', name: 'plan', turn: 0 };
      const miss: TutorRecord = { at: 11, screen: 'drill', kind: 'miss', name: 'fly', turn: 0, why: 'there is no command called "fly"' };
      const home: TutorRecord = { at: 12, screen: 'home', kind: 'ask', name: 'today', turn: 2 };
      await store.note([ask, miss]);
      await store.note([home]);
      await store.note([]);
      expect(await store.record()).toEqual([ask, miss, home]);
      expect(await store.record('drill')).toEqual([ask, miss]);
      expect(await store.record('home')).toEqual([home]);
      expect(await store.record('settings')).toEqual([]);
      const read = await store.record();
      read[0].name = 'changed';
      expect((await store.record())[0].name).toBe('plan');
    });

    it('keeps turn lines and weights lines, with the list applied, as they were noted', async () => {
      const store = make();
      const turn: TutorRecord = { at: 20, screen: 'drill', kind: 'turn', name: '', turn: 4 };
      const weights: TutorRecord = { at: 21, screen: 'drill', kind: 'weights', name: 'grist', turn: 0, names: ['plan', 'rusty'] };
      await store.note([turn, weights]);
      expect(await store.record('drill')).toEqual([turn, weights]);
      const read = await store.record();
      read[1].names!.push('changed');
      expect((await store.record())[1].names).toEqual(['plan', 'rusty']);
    });

    it("keeps each screen's up-front list, empty until set", async () => {
      const store = make();
      expect(await store.upFront('drill')).toEqual([]);
      await store.setUpFront('drill', ['plan', 'rusty']);
      await store.setUpFront('home', ['today']);
      expect(await store.upFront('drill')).toEqual(['plan', 'rusty']);
      expect(await store.upFront('home')).toEqual(['today']);
      await store.setUpFront('drill', ['rusty']);
      const read = await store.upFront('drill');
      expect(read).toEqual(['rusty']);
      read.push('x');
      expect(await store.upFront('drill')).toEqual(['rusty']);
      await store.setUpFront('drill', []);
      expect(await store.upFront('drill')).toEqual([]);
    });
  });
}
