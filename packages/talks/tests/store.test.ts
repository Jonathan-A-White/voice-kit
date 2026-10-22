import { describe, expect, it } from 'vitest';
import { createMemoryStore, type TalkStore } from '../src/index.js';

// One contract any TalkStore keeps; the in-memory one runs it here (a Dexie store joins it later).
export function storeContract(name: string, make: () => TalkStore) {
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
  });
}

storeContract('the in-memory store', () => createMemoryStore());
