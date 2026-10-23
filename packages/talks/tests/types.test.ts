import { describe, expect, expectTypeOf, it } from 'vitest';
import { createMemoryStore, type Talk, type TalkReader, type TalkStore, type TalkSummary, type Turn } from '../src/index.js';
import type { TalkListProps } from '../src/TalkList.js';

// The type argument is optional everywhere: an app that gives no fields writes the types as it always did. A type error here is
// a failing typecheck.
describe('app fields on a turn: the defaults', () => {
  it('Turn, Talk, TalkSummary and TalkStore compile without a type argument', () => {
    const turn: Turn = { role: 'user', text: 'hi', at: 1 };
    const withFields: Turn = { ...turn, fields: { anything: 1 } };
    const store: TalkStore = createMemoryStore();
    const reader: TalkReader = store;
    const talk: Talk = { id: 'a', title: '', turns: [withFields], memory: { facts: [], summary: '' }, createdAt: 1, updatedAt: 1 };
    const summary: TalkSummary = { id: 'a', title: '', turnCount: 1, firstText: '', createdAt: 1, updatedAt: 1, fields: { firstQuestion: 'x' } };
    expect([reader, talk, summary]).toHaveLength(3);
    expectTypeOf(turn.fields).toEqualTypeOf<Record<string, unknown> | undefined>();
  });

  it('TalkList takes a store without a type argument, and a reader of list and get only', () => {
    const props: TalkListProps = { store: createMemoryStore(), onOpen: () => {} };
    const reader: TalkReader = { list: async () => [], get: async () => undefined };
    const readerProps: TalkListProps = { store: reader, onOpen: () => {} };
    expect([props, readerProps]).toHaveLength(2);
  });

  it('an app can name its own fields', async () => {
    interface Mine {
      cleanQ?: string;
      n: number;
    }
    const store: TalkStore<Mine> = createMemoryStore<Mine>();
    const { id } = await store.create();
    const talk = await store.append(id, [{ role: 'user', text: 'q', at: 1, fields: { n: 2 } }]);
    expectTypeOf(talk.turns[0].fields).toEqualTypeOf<Mine | undefined>();
    expect(talk.turns[0].fields?.n).toBe(2);
    // @ts-expect-error a field the app did not name
    const bad: Turn<Mine> = { role: 'user', text: 'q', at: 1, fields: { other: 1 } };
    expect(bad).toBeTruthy();
  });
});
