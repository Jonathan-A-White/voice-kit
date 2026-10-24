// @vitest-environment jsdom
// ONE hold for the Composer and useTalk (mw-06ggew.14). Lampas's Talk sheet (useTalk + TalkBar) cut him off at '...and it's'
// where Postern's Composer keeps every word: whatever ends a hold (a release, the recogniser failing, a cancel, the recogniser
// ending by itself and not starting again, the page hidden), the words heard so far are handed on, the same through both, and
// the hold says when it starts and ends (onHoldStart, onHoldEnd). Each way is run against both, through the real recogniser path
// (listen.ts over the fake SpeechRecognition).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Composer, TalkBar, useTalk, type ComposerMessage, type HoldEnd, type HoldEnding, type HoldWords, type TalkOptions } from '../src/index.js';
import { FakeRecognizer, clearInputs, installRecognizer } from './support/fakes.js';

const pass = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

/** His words from the Lampas screenshot, 2026-10-21: the message stopped at 'and it's'. */
const SAID = 'John refers to himself as the Elder and it’s';

const BAR = /^(Hold to talk|Try again|Release to send|Let go to keep it unsent|Starting the mic…)$/;
const bar = () => screen.getByRole('button', { name: BAR });

/** What a hold handed on: sent (the words went as heard) or kept (unsent, for him to send), and how it ended. */
type Handed = { as: 'sent' | 'kept'; text: string };

interface Harness {
  open(): void;
  /** Everything the hold handed on, in order. */
  handed(): Handed[];
  /** onHoldStart and onHoldEnd, in order. */
  calls: string[];
}

function composer(): Harness {
  const sent: ComposerMessage[] = [];
  const calls: string[] = [];
  return {
    calls,
    open() {
      render(
        <Composer
          onSend={async (message) => {
            sent.push(message);
            return true;
          }}
          onHoldStart={() => calls.push('start')}
          onHoldEnd={(end: HoldEnd) => calls.push(`end:${end.cancelled}:${end.ended}`)}
        />,
      );
    },
    handed() {
      const box = screen.queryByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement | null;
      return [...sent.map((m): Handed => ({ as: 'sent', text: m.text })), ...(box?.value ? [{ as: 'kept' as const, text: box.value }] : [])];
    },
  };
}

/** An app's own talk control, as Lampas's Talk sheet is: useTalk's bar, and its notice drawn beside it. */
function Talker(options: TalkOptions) {
  const held = useTalk(undefined, options);
  return (
    <>
      <TalkBar talk={held} />
      {held.notice && <p>{held.notice}</p>}
    </>
  );
}

function talk(): Harness {
  const words: { text: string; released: HoldWords }[] = [];
  const calls: string[] = [];
  return {
    calls,
    open() {
      render(
        <Talker
          onWords={(text, released) => words.push({ text, released })}
          onHoldStart={() => calls.push('start')}
          onHoldEnd={(end: HoldEnd) => calls.push(`end:${end.cancelled}:${end.ended}`)}
        />,
      );
    },
    handed() {
      return words.map(({ text, released }) => ({ as: released.status === 'heard' ? 'sent' : 'kept', text }));
    },
  };
}

const recognizer = () => FakeRecognizer.instances.at(-1)!;

async function holdAndSay(words: string) {
  fireEvent.pointerDown(bar());
  await pass();
  act(() => recognizer().hear(words));
  await pass(2000);
}

/** The ways a hold ends, each as he would meet it. */
const ENDINGS: { ended: HoldEnding; how: string; end: () => Promise<void>; as: Handed['as']; cancelled: boolean }[] = [
  {
    ended: 'release',
    how: 'he lets go',
    as: 'sent',
    cancelled: false,
    end: async () => {
      fireEvent.pointerUp(bar(), { clientX: 10, clientY: 10 });
      await pass();
      await pass();
    },
  },
  {
    ended: 'error',
    how: 'the recogniser fails while he holds (the microphone taken: audio-capture)',
    as: 'kept',
    cancelled: true,
    end: async () => {
      await act(async () => recognizer().onerror?.({ error: 'audio-capture' }));
      await pass();
    },
  },
  {
    ended: 'cancel',
    how: 'the phone takes the touch (pointer cancel)',
    as: 'kept',
    cancelled: true,
    end: async () => {
      fireEvent.pointerCancel(bar());
      await pass();
    },
  },
  {
    ended: 'ended',
    how: 'the recogniser ends by itself and cannot be started again',
    as: 'kept',
    cancelled: true,
    end: async () => {
      const ended = recognizer();
      ended.start = () => {
        throw new Error("InvalidStateError: recognition has already started");
      };
      await act(async () => ended.onend?.());
      await pass();
      await pass();
    },
  },
  {
    ended: 'hidden',
    how: 'he leaves the app (the page hidden)',
    as: 'kept',
    cancelled: true,
    end: async () => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      await act(async () => document.dispatchEvent(new Event('visibilitychange')));
      await pass();
    },
  },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  installRecognizer();
  clearInputs();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each([
  { via: 'Composer', make: composer },
  { via: 'useTalk', make: talk },
])('one hold, through $via', ({ make }) => {
  for (const { ended, how, end, as, cancelled } of ENDINGS) {
    it(`${ended}: when ${how}, the words heard so far are handed on (${as}), between onHoldStart and onHoldEnd`, async () => {
      const harness = make();
      harness.open();
      await holdAndSay(SAID);
      expect(harness.calls).toEqual(['start']);
      await end();
      expect(harness.handed()).toEqual([{ as, text: SAID }]);
      expect(harness.calls).toEqual(['start', `end:${cancelled}:${ended}`]);
      // the hold is over: the bar (when it shows) is no longer listening
      const shown = screen.queryByRole('button', { name: BAR });
      if (shown) expect(shown.getAttribute('data-state')).toBe('idle');
    });
  }

  it('the recogniser ending by itself says the words after it could not be made out', async () => {
    const harness = make();
    harness.open();
    await holdAndSay(SAID);
    await ENDINGS.find((e) => e.ended === 'ended')!.end();
    expect(screen.getByText(/could not be made out/)).toBeTruthy();
  });
});
