// @vitest-environment jsdom
// A talk driven through the Composer's useTalk (mw-79en7t.29): he holds, the words come to onWords, and onWords asks the
// talk, which sends the turn through the injected grind. The composer is used as it is.
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useTalk, type ListenOptions, type ListenResult, type Transcriber } from 'voice-kit/composer';
import { createMemoryStore, createTalks, type OutgoingPicture, type TalkRequest } from '../src/index.js';

/** A transcriber the test drives by hand: it opens the mic, yields words, and settles on release. */
function fakeTranscriber() {
  let options: ListenOptions | undefined;
  let text = '';
  return {
    supported: () => true,
    start(given: ListenOptions) {
      options = given;
      text = '';
      return {
        ok: true as const,
        session: {
          mode: 'on-device' as const,
          stop: (): Promise<ListenResult> => Promise.resolve({ ok: true, text, mode: 'on-device' }),
          abort: () => {},
        },
      };
    },
    open: () => options?.onStart?.(),
    yields(words: string) {
      text = words;
      options?.onInterim?.(words);
    },
  } satisfies Transcriber & { open(): void; yields(words: string): void };
}

const pass = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a talk driven through useTalk', () => {
  it('sends each held turn through the injected grind and keeps the talk', async () => {
    const store = createMemoryStore();
    const grind = vi.fn(async (request: TalkRequest, files: OutgoingPicture[]) => {
      void files;
      return `heard: ${request.message}`;
    });
    const talks = createTalks({ store, send: grind });
    const { id } = await talks.start({ title: 'By voice' });
    const transcriber = fakeTranscriber();

    function Bar() {
      const [last, setLast] = useState('');
      const talk = useTalk(undefined, {
        transcriber,
        onWords: (words, heard) => {
          if (heard.status !== 'heard') return;
          void talks.ask(id, words).then((done) => setLast(done.answer));
        },
      });
      return (
        <div>
          <button type="button" {...talk.bar}>
            {talk.listening ? 'Release' : 'Hold'}
          </button>
          <p data-testid="last">{last}</p>
        </div>
      );
    }

    render(<Bar />);
    for (const words of ['what is grace', 'and mercy', 'thank you']) {
      fireEvent.pointerDown(screen.getByRole('button'));
      await pass();
      act(() => transcriber.open());
      act(() => transcriber.yields(words));
      await pass(100);
      expect(screen.getByRole('button').textContent).toBe('Release');
      fireEvent.pointerUp(screen.getByRole('button'), { clientX: 10, clientY: 10 });
      await pass();
      await pass();
      await pass();
      expect(screen.getByTestId('last').textContent).toBe(`heard: ${words}`);
    }

    expect(grind).toHaveBeenCalledTimes(3);
    expect(grind.mock.calls.map(([request]) => request.message)).toEqual(['what is grace', 'and mercy', 'thank you']);
    // the third turn went with the first two as its history
    expect(grind.mock.calls[2][0].history.map((h) => h.text)).toEqual(['what is grace', 'heard: what is grace', 'and mercy', 'heard: and mercy']);
    const kept = (await store.get(id))!;
    expect(kept.turns.map((t) => `${t.role}:${t.text}`)).toEqual([
      'user:what is grace',
      'assistant:heard: what is grace',
      'user:and mercy',
      'assistant:heard: and mercy',
      'user:thank you',
      'assistant:heard: thank you',
    ]);
  });
});
