import { Dexie } from 'dexie';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { createDexieStore, type DexieTalkStore } from '../src/dexieStore.js';
import { storeContract } from './storeContract.js';

let opened: DexieTalkStore[] = [];
let n = 0;
const fresh = (): DexieTalkStore => {
  const store = createDexieStore({ name: `talks-test-${++n}`, indexedDB, IDBKeyRange });
  opened.push(store);
  return store;
};
afterEach(() => {
  for (const s of opened) s.close();
  opened = [];
});

// the same contract as the in-memory store, over IndexedDB (fake-indexeddb)
storeContract('the Dexie store', fresh);

describe('the Dexie store, beyond the contract', () => {
  it('keeps talks across a close and a reopen of the same database', async () => {
    const first = createDexieStore({ name: 'talks-reopen', indexedDB, IDBKeyRange });
    const { id } = await first.create({ title: 'Kept', now: 1 });
    await first.append(id, [{ role: 'user', text: 'hello', at: 2, pictures: [{ bytes: new Uint8Array([7, 8]), mime: 'image/png', name: 'p.png' }] }]);
    await first.setMemory(id, { facts: ['a'], summary: 's' });
    first.close();
    const second = createDexieStore({ name: 'talks-reopen', indexedDB, IDBKeyRange });
    opened.push(second);
    const talk = (await second.get(id))!;
    expect(talk.title).toBe('Kept');
    expect(talk.turns).toHaveLength(1);
    expect(Array.from(talk.turns[0].pictures![0].bytes)).toEqual([7, 8]);
    expect(talk.memory).toEqual({ facts: ['a'], summary: 's' });
  });

  it('opens a version-1 database (before the tutor tables) and keeps its talks', async () => {
    const old = new Dexie('talks-version-1', { indexedDB, IDBKeyRange });
    old.version(1).stores({ talks: 'id, updatedAt', turns: '++seq, talkId' });
    await old.table('talks').add({ id: 'kept', title: 'From before', memory: { facts: [], summary: '' }, createdAt: 1, updatedAt: 2, turnCount: 1, firstText: 'hello' });
    await old.table('turns').add({ talkId: 'kept', role: 'user', text: 'hello', at: 2 });
    old.close();
    const store = createDexieStore({ name: 'talks-version-1', indexedDB, IDBKeyRange });
    opened.push(store);
    expect((await store.get('kept'))!.turns.map((t) => t.text)).toEqual(['hello']);
    expect(await store.record()).toEqual([]);
    await store.note([{ at: 3, screen: 'home', kind: 'ask', name: 'today', turn: 0 }]);
    expect(await store.record('home')).toHaveLength(1);
  });

  it('remove takes the turns with the talk, and two talks do not share turns', async () => {
    const store = fresh();
    const a = await store.create();
    const b = await store.create();
    await store.append(a.id, [{ role: 'user', text: 'a1', at: 1 }]);
    await store.append(b.id, [{ role: 'user', text: 'b1', at: 2 }]);
    await store.remove(a.id);
    expect((await store.get(b.id))!.turns.map((t) => t.text)).toEqual(['b1']);
    expect(await store.get(a.id)).toBeUndefined();
  });
});
