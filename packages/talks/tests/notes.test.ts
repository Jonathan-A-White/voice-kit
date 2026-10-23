import { describe, expect, it } from 'vitest';
import { applyNoteUpdates, isNoteUpdate, readNoteUpdates, type NoteStore, type NoteUpdate, type NoteWrite } from '../src/index.js';

const limits = { nameMax: 60, appendMax: 300, replaceMax: 2000 };

/** An in-memory NoteStore that records its calls; names that start with 'topic:' or 'book:' are in its scheme. */
function setup(answer: (call: string) => NoteWrite | Promise<NoteWrite> = () => 'saved') {
  const calls: string[] = [];
  const notes: NoteStore = {
    nameOf: (raw) => (/^(topic|book):\S+$/.test(raw) ? raw : null),
    append: async (name, text, when) => {
      calls.push(`append ${name} ${text} @${when}`);
      return answer(`append ${name}`);
    },
    replace: async (name, text, when) => {
      calls.push(`replace ${name} ${text} @${when}`);
      return answer(`replace ${name}`);
    },
    remove: async (name, when) => {
      calls.push(`remove ${name} @${when}`);
      return answer(`remove ${name}`);
    },
  };
  return { notes, calls };
}

describe('applyNoteUpdates', () => {
  it('writes an append on a name the scheme knows, with when, and says Added to', async () => {
    const { notes, calls } = setup();
    const change = await applyNoteUpdates([{ name: 'topic:grace', append: 'asked twice' }], notes, { when: 42 });
    expect(calls).toEqual(['append topic:grace asked twice @42']);
    expect(change).toEqual({ applied: ['Added to topic:grace'], refused: [] });
  });

  it('uses the time now when no when is given', async () => {
    const { notes, calls } = setup();
    const before = Date.now();
    await applyNoteUpdates([{ name: 'topic:grace', append: 'x' }], notes);
    const at = Number(/@(\d+)$/.exec(calls[0])?.[1]);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it('refuses a replace and a remove that are not directed, without calling the store, and warns each line', async () => {
    const { notes, calls } = setup();
    const warned: string[] = [];
    const change = await applyNoteUpdates(
      [
        { name: 'book:Romans', replace: 'new text' },
        { name: 'topic:grace', remove: true },
      ],
      notes,
      { when: 1, warn: (line) => warned.push(line) },
    );
    const why = 'a replace or remove needs his words in this talk';
    expect(calls).toEqual([]);
    expect(change.applied).toEqual([]);
    expect(change.refused).toEqual([`Did not change book:Romans: ${why}`, `Did not change topic:grace: ${why}`]);
    expect(warned).toEqual(change.refused);
  });

  it('writes a directed replace and a directed remove', async () => {
    const { notes, calls } = setup();
    const change = await applyNoteUpdates(
      [
        { name: 'book:Romans', replace: 'new text', directed: true },
        { name: 'topic:grace', remove: true, directed: true },
      ],
      notes,
      { when: 7 },
    );
    expect(calls).toEqual(['replace book:Romans new text @7', 'remove topic:grace @7']);
    expect(change).toEqual({ applied: ['Replaced book:Romans', 'Removed topic:grace'], refused: [] });
  });

  it('refuses a name the scheme does not know, even directed, and does not call the store', async () => {
    const { notes, calls } = setup();
    const change = await applyNoteUpdates([{ name: 'secret:x', replace: 'y', directed: true }, { name: 'nope', append: 'z' }], notes);
    expect(calls).toEqual([]);
    expect(change.refused).toEqual(['Did not change secret:x: not a name in the scheme', 'Did not change nope: not a name in the scheme']);
  });

  it('refuses with the reason a store answers, and with the message of one that throws, and runs the next update', async () => {
    const { notes, calls } = setup((call) => {
      if (call === 'append topic:long') return 'too-long';
      if (call === 'append topic:boom') throw new Error('disk full');
      if (call === 'append topic:odd') throw 'plain string';
      return 'saved';
    });
    const warned: string[] = [];
    const change = await applyNoteUpdates(
      [
        { name: 'topic:long', append: 'a' },
        { name: 'topic:boom', append: 'b' },
        { name: 'topic:odd', append: 'c' },
        { name: 'topic:fine', append: 'd' },
      ],
      notes,
      { when: 3, warn: (line) => warned.push(line) },
    );
    expect(calls).toHaveLength(4);
    expect(change.applied).toEqual(['Added to topic:fine']);
    expect(change.refused).toEqual([
      'Did not change topic:long: too-long',
      'Did not change topic:boom: disk full',
      'Did not change topic:odd: could not be written',
    ]);
    expect(warned).toEqual(change.refused);
  });

  it('refuses a directed replace or remove the store answers with a reason, and a rejected promise', async () => {
    const { notes } = setup((call) => (call.startsWith('replace') ? 'not-found' : 'saved'));
    const change = await applyNoteUpdates([{ name: 'topic:a', replace: 'x', directed: true }, { name: 'topic:b', remove: true, directed: true }], notes);
    expect(change).toEqual({ applied: ['Removed topic:b'], refused: ['Did not change topic:a: not-found'] });
    const rejecting: NoteStore = { ...notes, remove: () => Promise.reject(new Error('gone')) };
    expect((await applyNoteUpdates([{ name: 'topic:b', remove: true, directed: true }], rejecting)).refused).toEqual(['Did not change topic:b: gone']);
  });

  it('does not throw when nameOf throws or warn throws', async () => {
    const { notes } = setup();
    const bad: NoteStore = { ...notes, nameOf: () => { throw new Error('bad scheme'); } };
    const change = await applyNoteUpdates([{ name: 'topic:a', append: 'x' }], bad, { warn: () => { throw new Error('log'); } });
    expect(change.refused).toEqual(['Did not change topic:a: bad scheme']);
  });

  it('writes under the name the scheme gives, and names that name in the line', async () => {
    const { notes, calls } = setup();
    const folding: NoteStore = { ...notes, nameOf: (raw) => (raw.startsWith('Topic:') ? raw.toLowerCase() : null) };
    const change = await applyNoteUpdates([{ name: 'Topic:Grace', append: 'x' }], folding, { when: 5 });
    expect(calls).toEqual(['append topic:grace x @5']);
    expect(change.applied).toEqual(['Added to topic:grace']);
  });
});

describe('isNoteUpdate', () => {
  it('takes the four good shapes', () => {
    expect(isNoteUpdate({ name: 'topic:a', append: 'x' }, limits)).toBe(true);
    expect(isNoteUpdate({ name: 'topic:a', replace: 'x' }, limits)).toBe(true);
    expect(isNoteUpdate({ name: 'topic:a', replace: 'x', directed: true }, limits)).toBe(true);
    expect(isNoteUpdate({ name: 'topic:a', remove: true }, limits)).toBe(true);
    expect(isNoteUpdate({ name: 'topic:a', remove: true, directed: true }, limits)).toBe(true);
  });

  it('refuses a stray key, two actions at once, a directed append, an empty text and a text over its limit', () => {
    expect(isNoteUpdate({ name: 'topic:a', append: 'x', extra: 1 }, limits)).toBe(false);
    expect(isNoteUpdate({ name: 'topic:a', append: 'x', replace: 'y' }, limits)).toBe(false);
    expect(isNoteUpdate({ name: 'topic:a', append: 'x', remove: true }, limits)).toBe(false);
    expect(isNoteUpdate({ name: 'topic:a' }, limits)).toBe(false);
    expect(isNoteUpdate({ name: 'topic:a', append: 'x', directed: true }, limits)).toBe(false);
    expect(isNoteUpdate({ name: 'topic:a', replace: 'x', directed: false }, limits)).toBe(false);
    expect(isNoteUpdate({ name: 'topic:a', remove: false }, limits)).toBe(false);
    expect(isNoteUpdate({ name: 'topic:a', append: '' }, limits)).toBe(false);
    expect(isNoteUpdate({ name: 'topic:a', replace: '  ' }, limits)).toBe(false);
    expect(isNoteUpdate({ name: 'topic:a', append: 'x'.repeat(301) }, limits)).toBe(false);
    expect(isNoteUpdate({ name: 'topic:a', replace: 'x'.repeat(2001) }, limits)).toBe(false);
    expect(isNoteUpdate({ name: 'topic:a', append: 'x'.repeat(300) }, limits)).toBe(true);
    expect(isNoteUpdate({ name: 'topic:a', replace: 'x'.repeat(2000) }, limits)).toBe(true);
  });

  it('refuses a name that is missing, empty, not text or too long, and a value that is not an object', () => {
    expect(isNoteUpdate({ append: 'x' }, limits)).toBe(false);
    expect(isNoteUpdate({ name: '', append: 'x' }, limits)).toBe(false);
    expect(isNoteUpdate({ name: 7, append: 'x' }, limits)).toBe(false);
    expect(isNoteUpdate({ name: 'n'.repeat(61), append: 'x' }, limits)).toBe(false);
    expect(isNoteUpdate({ name: 'n'.repeat(60), append: 'x' }, limits)).toBe(true);
    for (const v of [null, undefined, 'topic:a', 3, [], [{ name: 'a', append: 'x' }]]) expect(isNoteUpdate(v, limits)).toBe(false);
  });
});

describe('readNoteUpdates', () => {
  const good: NoteUpdate[] = [{ name: 'topic:a', append: 'x' }, { name: 'book:b', remove: true, directed: true }];

  it('returns the list of an answer whose memory_update is all good', () => {
    expect(readNoteUpdates({ text: 'hi', memory_update: good }, limits)).toEqual(good);
    expect(readNoteUpdates({ memory_update: [] }, limits)).toEqual([]);
  });

  it('returns undefined for a malformed list, one bad entry, no list, or an answer that is not an object', () => {
    expect(readNoteUpdates({ memory_update: [...good, { name: 'topic:a', append: 'x', replace: 'y' }] }, limits)).toBeUndefined();
    expect(readNoteUpdates({ memory_update: { name: 'topic:a', append: 'x' } }, limits)).toBeUndefined();
    expect(readNoteUpdates({ memory_update: 'nope' }, limits)).toBeUndefined();
    expect(readNoteUpdates({ text: 'hi' }, limits)).toBeUndefined();
    for (const a of [null, undefined, 'text', 4, []]) expect(readNoteUpdates(a, limits)).toBeUndefined();
  });
});
