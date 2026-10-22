import { describe, expect, it } from 'vitest';
import { applyMemoryUpdate, createMemoryStore, createTalks, readMemoryUpdate, type MemoryUpdate, type TalkRequest } from '../src/index.js';

/** A fake grind that answers with text and, for the message that says "remember", a memory update. */
function setup() {
  const store = createMemoryStore({ newId: (() => { let n = 0; return () => `talk-${++n}`; })() });
  const sent: TalkRequest[] = [];
  const send = async (request: TalkRequest) => {
    sent.push(request);
    const fact = /^my (.+)$/.exec(request.message)?.[1];
    return { text: `answer to ${request.message}`, ...(fact ? { memory_update: { add: [fact] } } : {}) };
  };
  return { store, sent, talks: createTalks({ store, send }) };
}

describe('a talk remembers', () => {
  it('carries a fact from turn 1 in the request of turn 30, long after the history has moved on', async () => {
    const { talks, sent, store } = setup();
    const talk = await talks.start();
    await talks.ask(talk.id, 'my dog is called Rex');
    for (let i = 2; i <= 29; i++) await talks.ask(talk.id, `question ${i}`);
    await talks.ask(talk.id, 'question 30');
    expect(sent).toHaveLength(30);
    expect(sent[29].history.some((h) => h.text.includes('Rex'))).toBe(false);
    expect(sent[29].memory?.facts).toEqual(['dog is called Rex']);
    expect(sent[0].memory).toBeUndefined();
    expect((await store.get(talk.id))!.memory.facts).toEqual(['dog is called Rex']);
  });

  it('forgets with the talk: a deleted talk leaves no row, and the next talk does not carry its fact', async () => {
    const { talks, sent, store } = setup();
    const first = await talks.start();
    await talks.ask(first.id, 'my dog is called Rex');
    await store.remove(first.id);
    expect(await store.get(first.id)).toBeUndefined();
    expect(await store.list()).toEqual([]);
    const next = await talks.start();
    await talks.ask(next.id, 'what is my dog called?');
    expect(sent.at(-1)!.memory).toBeUndefined();
    expect(JSON.stringify(sent.at(-1))).not.toContain('Rex');
  });

  it('keeps a rolling summary the grind rewrites, and carries it with the facts', async () => {
    const store = createMemoryStore();
    const sent: TalkRequest[] = [];
    const talks = createTalks({
      store,
      send: async (request: TalkRequest) => {
        sent.push(request);
        return { text: 'ok', memory_update: { summary: `summary after ${sent.length}` } };
      },
    });
    const talk = await talks.start();
    await talks.ask(talk.id, 'one');
    await talks.ask(talk.id, 'two');
    expect(sent[1].memory).toEqual({ facts: [], summary: 'summary after 1' });
    expect((await store.get(talk.id))!.memory.summary).toBe('summary after 2');
  });

  it('lets the app remember and forget by hand, and reports what was applied and refused', async () => {
    const { talks, store } = setup();
    const talk = await talks.start();
    const done = await talks.remember(talk.id, { add: ['likes Greek', '  ', 'likes Greek'], summary: 'about Greek' });
    expect(done.applied).toEqual(['Added: likes Greek', 'Summary changed']);
    expect(done.refused).toHaveLength(2);
    expect((await store.get(talk.id))!.memory).toEqual({ facts: ['likes Greek'], summary: 'about Greek' });
    await talks.remember(talk.id, { remove: ['LIKES greek'] });
    expect((await store.get(talk.id))!.memory.facts).toEqual([]);
    await expect(talks.remember('missing', { add: ['x'] })).rejects.toThrow();
  });

  it('asks nothing of a grind that answers plain text, and a malformed update changes nothing', async () => {
    const store = createMemoryStore();
    const talks = createTalks({ store, send: async () => ({ text: 'ok', memory_update: { add: 'not a list' } }) });
    const talk = await talks.start();
    const done = await talks.ask(talk.id, 'hello');
    expect(done.talk.memory).toEqual({ facts: [], summary: '' });
    const plain = createTalks({ store, send: async () => 'ok' });
    await plain.ask(talk.id, 'hello again');
    expect((await store.get(talk.id))!.turns).toHaveLength(4);
  });

  it('takes a memory reader for any grind and puts the memory in a custom request', async () => {
    const store = createMemoryStore();
    const seen: string[][] = [];
    const talks = createTalks({
      store,
      send: async (request: { q: string; kept: string[] }) => ({ said: request.q, learned: request.q.startsWith('my ') ? request.q.slice(3) : '' }),
      buildRequest: ({ talk, message }) => ({ q: message, kept: talk.memory.facts }),
      answerText: (a: { said: string }) => a.said,
      readMemory: (a: { learned: string }) => (a.learned ? { add: [a.learned] } : undefined),
    });
    const talk = await talks.start();
    await talks.ask(talk.id, 'my name is Sam');
    const wrapped = createTalks({
      store,
      send: async (request: { q: string; kept: string[] }) => { seen.push(request.kept); return 'ok'; },
      buildRequest: ({ talk: t, message }) => ({ q: message, kept: t.memory.facts }),
    });
    await wrapped.ask(talk.id, 'who am I?');
    expect(seen).toEqual([['name is Sam']]);
  });

  it('keeps the memory when maxRequestBytes cuts the history', async () => {
    const store = createMemoryStore();
    const sent: TalkRequest[] = [];
    const talks = createTalks({
      store,
      maxRequestBytes: 400,
      send: async (request: TalkRequest) => { sent.push(request); return { text: 'x'.repeat(200), memory_update: sent.length === 1 ? { add: ['the fact'] } : undefined }; },
    });
    const talk = await talks.start();
    for (let i = 0; i < 6; i++) await talks.ask(talk.id, `q${i}`);
    expect(sent.at(-1)!.memory?.facts).toEqual(['the fact']);
    expect(sent.at(-1)!.history.length).toBeLessThan(10);
  });
});

describe('applyMemoryUpdate', () => {
  const empty = { facts: [], summary: '' };

  it('adds trimmed facts once, in order, and removes by a case-blind match', () => {
    const a = applyMemoryUpdate(empty, { add: [' one ', 'two', 'ONE'] });
    expect(a.memory.facts).toEqual(['one', 'two']);
    expect(a.refused).toEqual(['Did not add "ONE": already kept']);
    const b = applyMemoryUpdate(a.memory, { remove: ['One', 'three'] });
    expect(b.memory.facts).toEqual(['two']);
    expect(b.refused).toEqual(['Did not remove "three": not kept']);
  });

  it('refuses a fact that is too long or a memory that is full, and cuts a summary that is too long', () => {
    const limits = { maxFacts: 2, maxFactChars: 10, maxSummaryChars: 8 };
    const r = applyMemoryUpdate(empty, { add: ['a', 'much too long a fact', 'b', 'c'], summary: '123456789012' }, limits);
    expect(r.memory.facts).toEqual(['a', 'b']);
    expect(r.refused).toHaveLength(2);
    expect(r.memory.summary).toBe('1234567…');
  });

  it('does not change what it was given', () => {
    const before = { facts: ['x'], summary: 's' };
    applyMemoryUpdate(before, { add: ['y'], summary: 't' });
    expect(before).toEqual({ facts: ['x'], summary: 's' });
  });
});

describe('readMemoryUpdate', () => {
  it('reads memory_update from an answer object, and nothing from anything else', () => {
    const update: MemoryUpdate = { add: ['a'], remove: ['b'], summary: 's' };
    expect(readMemoryUpdate({ memory_update: update })).toEqual(update);
    expect(readMemoryUpdate('text')).toBeUndefined();
    expect(readMemoryUpdate({ text: 'x' })).toBeUndefined();
    expect(readMemoryUpdate({ memory_update: { add: [1] } })).toBeUndefined();
    expect(readMemoryUpdate({ memory_update: { extra: true } })).toBeUndefined();
  });
});
