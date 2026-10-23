import { describe, expect, it } from 'vitest';
import * as everything from '../src/index.js';
import { createFakeGrind, createFakeTalkStore } from '../src/talks.js';
// the fakes must meet the real interfaces; a type error here is a failing typecheck
import { createTalks, type TalkStore } from '../../talks/src/index.js';

describe('createFakeGrind', () => {
  it('answers the scripted turns in order and records each call', async () => {
    const grind = createFakeGrind(['one', { text: 'two' }]);
    const files = [{ bytes: new Uint8Array([1]), mime: 'image/png', name: 'p.png' }];
    expect(await grind.send({ message: 'a' }, files)).toBe('one');
    expect(await grind.send({ message: 'b' }, [])).toEqual({ text: 'two' });
    expect(grind.calls).toEqual([
      { request: { message: 'a' }, files },
      { request: { message: 'b' }, files: [] },
    ]);
    expect(grind.calls).toHaveLength(2);
  });

  it('answers with a function of the request, and rejects with a scripted error', async () => {
    const grind = createFakeGrind([(request: { message: string }) => `echo ${request.message}`, new Error('the grind is down')]);
    expect(await grind.send({ message: 'hi' }, [])).toBe('echo hi');
    await expect(grind.send({ message: 'again' }, [])).rejects.toThrow('the grind is down');
    expect(grind.calls).toHaveLength(2);
  });

  it('says so when the script is used up, rather than inventing an answer', async () => {
    const grind = createFakeGrind(['only']);
    await grind.send({}, []);
    await expect(grind.send({}, [])).rejects.toThrow(/script is used up/);
  });

  it('drives the real turn loop', async () => {
    const grind = createFakeGrind(['Grace is a gift.']);
    const store = createFakeTalkStore();
    const talks = createTalks({ store, send: grind.send });
    const { id } = await talks.start({ title: 'T' });
    await talks.ask(id, 'what is grace');
    expect((await store.get(id))!.turns.map((t) => t.text)).toEqual(['what is grace', 'Grace is a gift.']);
    expect((grind.calls[0].request as { message: string }).message).toBe('what is grace');
  });
});

describe('createFakeTalkStore', () => {
  it('is a TalkStore and keeps what it is given', async () => {
    const store: TalkStore = createFakeTalkStore();
    const { id } = await store.create({ title: 'A', now: 1 });
    await store.append(id, [{ role: 'user', text: 'hi', at: 2 }]);
    await store.rename(id, 'B');
    await store.setMemory(id, { facts: ['f'], summary: 's' });
    expect(await store.get(id)).toMatchObject({ title: 'B', turns: [{ text: 'hi' }], memory: { facts: ['f'], summary: 's' }, updatedAt: 2 });
    expect(await store.list()).toEqual([{ id, title: 'B', turnCount: 1, firstText: 'hi', createdAt: 1, updatedAt: 2 }]);
    await store.remove(id);
    expect(await store.get(id)).toBeUndefined();
  });

  it('records every call, in order, with its arguments', async () => {
    const store = createFakeTalkStore();
    const { id } = await store.create({ title: 'A' });
    await store.append(id, [{ role: 'user', text: 'hi', at: 2 }]);
    await store.get(id);
    await store.remove(id);
    expect(store.calls.map((c) => c.method)).toEqual(['create', 'append', 'get', 'remove']);
    expect(store.calls[1].args).toEqual([id, [{ role: 'user', text: 'hi', at: 2 }]]);
  });

  it('rejects a talk that is not there, like the real stores', async () => {
    const store = createFakeTalkStore();
    await expect(store.append('missing', [])).rejects.toThrow(/no talk/);
    expect(await store.get('missing')).toBeUndefined();
    await store.remove('missing');
  });

  it('hands out copies', async () => {
    const store = createFakeTalkStore();
    const { id } = await store.create();
    await store.append(id, [{ role: 'user', text: 'a', at: 1 }]);
    (await store.get(id))!.turns[0].text = 'changed';
    expect((await store.get(id))!.turns[0].text).toBe('a');
  });
});

describe('createFakeTalkStore: app fields on a turn', () => {
  it('records an append with fields and gives them back by copy', async () => {
    const store = createFakeTalkStore();
    const { id } = await store.create();
    const fields = { cleanQ: 'x', nested: { n: 1 } };
    await store.append(id, [{ role: 'user', text: 'q', at: 1, fields }, { role: 'assistant', text: 'a', at: 2 }]);
    expect(store.calls[1].args).toEqual([id, [{ role: 'user', text: 'q', at: 1, fields }, { role: 'assistant', text: 'a', at: 2 }]]);
    fields.nested.n = 2;
    const read = (await store.get(id))!;
    expect(read.turns[0].fields).toEqual({ cleanQ: 'x', nested: { n: 1 } });
    expect('fields' in read.turns[1]).toBe(false);
    (read.turns[0].fields as typeof fields).cleanQ = 'changed';
    expect((await store.get(id))!.turns[0].fields).toEqual({ cleanQ: 'x', nested: { n: 1 } });
  });
});

describe('the index', () => {
  it('still exports the speech and mic fakes, and adds the talk fakes', () => {
    for (const name of ['installSpeech', 'speechInitScript', 'installMic', 'micInitScript', 'clips', 'createFakeGrind', 'createFakeTalkStore']) {
      expect(Object.keys(everything), name).toContain(name);
    }
  });
});
