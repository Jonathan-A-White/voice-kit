// @vitest-environment jsdom
// useTalk and TalkBar (mw-06ggew.3): the hold bar and its hook alone, for a caller with its own handler for the words
// (Lampas's Talk sheet, Reader, Welcome, LetterDrill). talk hold|tap|off from the same settings; Space/Enter held on the
// bar is a hold; holdDelayMs waits before listening starts; a slide off cancels and says so to onHoldEnd, its words handed on kept.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { browserSpeech, LATCH_MS, TalkBar, useTalk } from '../src/index.js';
import { clearInputs, FakeRecognizer, fakeTranscriber, installRecognizer } from './support/fakes.js';

const pass = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

const BAR = /^(Hold to talk|Try again|Release to send|Tap to stop|Let go to keep it unsent|Starting the mic…)$/;
const bar = () => screen.getByRole('button', { name: BAR });

const BOX = { left: 0, top: 0, right: 300, bottom: 96, width: 300, height: 96, x: 0, y: 0, toJSON: () => ({}) };

async function down() {
  fireEvent.pointerDown(bar());
  await pass();
}
async function up() {
  fireEvent.pointerUp(bar(), { clientX: 10, clientY: 10 });
  await pass();
  await pass();
}
async function press(ms: number) {
  await down();
  await pass(ms);
  await up();
}

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

describe('TalkBar: a hold, the words go to onWords', () => {
  it('a hold hands the words to onWords on release, between onHoldStart and onHoldEnd', async () => {
    const transcriber = fakeTranscriber();
    const calls: string[] = [];
    render(
      <TalkBar
        transcriber={transcriber}
        onHoldStart={() => calls.push('start')}
        onHoldEnd={(end) => calls.push(`end:${end.cancelled}`)}
        onWords={(text) => calls.push(`words:${text}`)}
      />,
    );
    await down();
    expect(calls).toEqual(['start']);
    act(() => transcriber.open());
    act(() => transcriber.yields('what is grace'));
    await pass(100);
    expect(bar().textContent).toContain('Release to send');
    await up();
    expect(calls).toEqual(['start', 'end:false', 'words:what is grace']);
    expect(bar().textContent).toContain('Hold to talk');
  });

  it('labels are configurable', async () => {
    const transcriber = fakeTranscriber();
    render(<TalkBar transcriber={transcriber} onWords={() => {}} labels={{ hold: 'Hold to ask', release: 'Let go to ask' }} />);
    expect(screen.getByRole('button').textContent).toBe('Hold to ask');
    fireEvent.pointerDown(screen.getByRole('button'));
    await pass();
    act(() => transcriber.open());
    expect(screen.getByRole('button').textContent).toBe('Let go to ask');
  });

  it('has the Composer bar look: the class bk-composer__bar and a data-state', async () => {
    const transcriber = fakeTranscriber();
    render(<TalkBar transcriber={transcriber} onWords={() => {}} className="mine" />);
    expect(bar().className).toBe('bk-composer__bar mine');
    expect(bar().getAttribute('data-state')).toBe('idle');
    await down();
    expect(bar().getAttribute('data-state')).toBe('listening');
  });

  it('a disabled bar is a disabled button (the browser sends it no press)', () => {
    render(<TalkBar transcriber={fakeTranscriber()} onWords={() => {}} disabled />);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('talk off', () => {
  it('renders nothing', () => {
    const { container } = render(<TalkBar settings={{ talk: 'off' }} transcriber={fakeTranscriber()} onWords={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('useTalk with talk off never starts a hold', async () => {
    const transcriber = fakeTranscriber();
    const { result } = renderHook(() => useTalk({ talk: 'off' }, { transcriber, onWords: () => {} }));
    expect(result.current.talk).toBe('off');
    await act(async () => {
      result.current.bar.onKeyDown({ key: ' ', repeat: false, preventDefault() {} } as never);
    });
    expect(transcriber.started).toBe(0);
  });
});

describe('talk tap, through useTalk', () => {
  it('a quick tap latches the mic on, the next tap stops it and the words go to onWords', async () => {
    const transcriber = fakeTranscriber();
    const onWords = vi.fn();
    const onHoldEnd = vi.fn();
    render(<TalkBar settings={{ talk: 'tap' }} transcriber={transcriber} onWords={onWords} onHoldEnd={onHoldEnd} />);
    await press(LATCH_MS - 50);
    expect(transcriber.started).toBe(1);
    expect(transcriber.stopped).toBe(false);
    act(() => transcriber.open());
    expect(bar().textContent).toContain('Tap to stop');
    expect(bar().getAttribute('data-state')).toBe('latched');
    act(() => transcriber.yields('keep it on'));
    await pass(5000);
    expect(transcriber.stopped).toBe(false);
    expect(onWords).not.toHaveBeenCalled();
    expect(onHoldEnd).not.toHaveBeenCalled();
    await press(50);
    expect(transcriber.stopped).toBe(true);
    expect(onWords).toHaveBeenCalledTimes(1);
    expect(onWords.mock.calls[0]![0]).toBe('keep it on');
    expect(onHoldEnd).toHaveBeenCalledWith({ cancelled: false, ended: 'release' });
    expect(bar().textContent).toContain('Hold to talk');
  });

  it('a press of LATCH_MS or longer is a hold: letting go stops it', async () => {
    const transcriber = fakeTranscriber();
    const onWords = vi.fn();
    render(<TalkBar settings={{ talk: 'tap' }} transcriber={transcriber} onWords={onWords} />);
    await down();
    act(() => transcriber.open());
    act(() => transcriber.yields('a long hold'));
    await pass(LATCH_MS);
    await up();
    expect(transcriber.stopped).toBe(true);
    expect(onWords.mock.calls[0]![0]).toBe('a long hold');
  });

  it('reads a 1 s hold as a hold when the wall clock steps back during it (mw-k4sekr.2)', async () => {
    const transcriber = fakeTranscriber();
    const onWords = vi.fn();
    render(<TalkBar settings={{ talk: 'tap' }} transcriber={transcriber} onWords={onWords} />);
    await down();
    act(() => transcriber.open());
    act(() => transcriber.yields('a long hold'));
    await pass(500);
    vi.setSystemTime(Date.now() - 3_600_000); // the host's clock corrected an hour back
    await pass(500);
    await up();
    expect(transcriber.stopped).toBe(true);
    expect(onWords.mock.calls[0]![0]).toBe('a long hold');
  });

  it('with talk hold a quick press never latches', async () => {
    const transcriber = fakeTranscriber();
    render(<TalkBar transcriber={transcriber} onWords={() => {}} />);
    await press(50);
    expect(transcriber.stopped).toBe(true);
  });
});

describe('the keyboard', () => {
  it.each([' ', 'Enter'])('%j held on the focused bar is a hold; letting the key up sends', async (key) => {
    const transcriber = fakeTranscriber();
    const onWords = vi.fn();
    render(<TalkBar transcriber={transcriber} onWords={onWords} />);
    fireEvent.keyDown(bar(), { key });
    await pass();
    expect(transcriber.started).toBe(1);
    // a key that repeats while held is not a new press
    fireEvent.keyDown(bar(), { key, repeat: true });
    await pass();
    expect(transcriber.started).toBe(1);
    act(() => transcriber.open());
    act(() => transcriber.yields('by key'));
    fireEvent.keyUp(bar(), { key });
    await pass();
    await pass();
    expect(transcriber.stopped).toBe(true);
    expect(onWords.mock.calls[0]![0]).toBe('by key');
  });

  it('another key does nothing', async () => {
    const transcriber = fakeTranscriber();
    render(<TalkBar transcriber={transcriber} onWords={() => {}} />);
    fireEvent.keyDown(bar(), { key: 'a' });
    await pass();
    expect(transcriber.started).toBe(0);
  });
});

describe('holdDelayMs', () => {
  it('listening starts only after the delay; onHoldStart comes with it', async () => {
    const transcriber = fakeTranscriber();
    const onHoldStart = vi.fn();
    render(<TalkBar transcriber={transcriber} onWords={() => {}} holdDelayMs={500} onHoldStart={onHoldStart} />);
    await down();
    await pass(499);
    expect(transcriber.started).toBe(0);
    expect(onHoldStart).not.toHaveBeenCalled();
    await pass(1);
    expect(transcriber.started).toBe(1);
    expect(onHoldStart).toHaveBeenCalledTimes(1);
    expect(bar().getAttribute('data-state')).toBe('listening');
  });

  it('a press let go before the delay is no hold: nothing starts, nothing is called', async () => {
    const transcriber = fakeTranscriber();
    const onHoldStart = vi.fn();
    const onHoldEnd = vi.fn();
    const onWords = vi.fn();
    render(<TalkBar transcriber={transcriber} onWords={onWords} holdDelayMs={500} onHoldStart={onHoldStart} onHoldEnd={onHoldEnd} />);
    await press(300);
    await pass(1000);
    expect(transcriber.started).toBe(0);
    expect(onHoldStart).not.toHaveBeenCalled();
    expect(onHoldEnd).not.toHaveBeenCalled();
    expect(onWords).not.toHaveBeenCalled();
  });

  it('sliding off the bar before the delay is over cancels the wait', async () => {
    const transcriber = fakeTranscriber();
    render(<TalkBar transcriber={transcriber} onWords={() => {}} holdDelayMs={500} />);
    await down();
    vi.spyOn(bar(), 'getBoundingClientRect').mockReturnValue(BOX);
    fireEvent.pointerMove(bar(), { clientX: 600, clientY: 10 });
    await pass(1000);
    expect(transcriber.started).toBe(0);
  });

  it('the delay also holds for the keyboard', async () => {
    const transcriber = fakeTranscriber();
    render(<TalkBar transcriber={transcriber} onWords={() => {}} holdDelayMs={200} />);
    fireEvent.keyDown(bar(), { key: ' ' });
    await pass(100);
    expect(transcriber.started).toBe(0);
    await pass(100);
    expect(transcriber.started).toBe(1);
  });
});

describe('a slide off', () => {
  it('cancels: the mic is dropped, the words so far go to onWords kept (unsent, mw-06ggew.14) and onHoldEnd says cancelled', async () => {
    const transcriber = fakeTranscriber();
    const onWords = vi.fn();
    const onHoldEnd = vi.fn();
    render(<TalkBar transcriber={transcriber} onWords={onWords} onHoldEnd={onHoldEnd} />);
    await down();
    act(() => transcriber.open());
    act(() => transcriber.yields('never mind'));
    vi.spyOn(bar(), 'getBoundingClientRect').mockReturnValue(BOX);
    fireEvent.pointerMove(bar(), { clientX: 600, clientY: 10 });
    expect(bar().textContent).toContain('Let go to keep it unsent');
    expect(bar().getAttribute('data-state')).toBe('slid');
    fireEvent.pointerUp(bar(), { clientX: 600, clientY: 10 });
    await pass();
    expect(transcriber.aborted).toBe(true);
    expect(onWords).toHaveBeenCalledTimes(1);
    expect(onWords).toHaveBeenCalledWith('never mind', { status: 'kept', text: 'never mind', recording: undefined, ended: 'cancel' });
    expect(onHoldEnd).toHaveBeenCalledWith({ cancelled: true, ended: 'cancel' });
    expect(bar().textContent).toContain('Hold to talk');
  });

  it('sliding back on the bar before letting go is no slide off', async () => {
    const transcriber = fakeTranscriber();
    const onWords = vi.fn();
    render(<TalkBar transcriber={transcriber} onWords={onWords} />);
    await down();
    act(() => transcriber.open());
    act(() => transcriber.yields('still here'));
    vi.spyOn(bar(), 'getBoundingClientRect').mockReturnValue(BOX);
    fireEvent.pointerMove(bar(), { clientX: 600, clientY: 10 });
    fireEvent.pointerMove(bar(), { clientX: 100, clientY: 10 });
    await up();
    expect(onWords.mock.calls[0]![0]).toBe('still here');
  });

  it('the phone taking the touch (pointer cancel) is a cancel too', async () => {
    const transcriber = fakeTranscriber();
    const onHoldEnd = vi.fn();
    render(<TalkBar transcriber={transcriber} onWords={() => {}} onHoldEnd={onHoldEnd} />);
    await down();
    fireEvent.pointerCancel(bar());
    await pass();
    expect(transcriber.aborted).toBe(true);
    expect(onHoldEnd).toHaveBeenCalledWith({ cancelled: true, ended: 'cancel' });
  });
});

describe('a hold that cannot go on', () => {
  it('a hold that cannot start ends cancelled, so what onHoldStart paused is given back', async () => {
    const transcriber = fakeTranscriber();
    transcriber.start = () => ({ ok: false, error: { kind: 'not-supported', message: 'This phone cannot turn speech into text.' } });
    const calls: string[] = [];
    render(<TalkBar transcriber={transcriber} onWords={() => {}} onHoldStart={() => calls.push('start')} onHoldEnd={(end) => calls.push(`end:${end.cancelled}`)} />);
    await down();
    expect(calls).toEqual(['start', 'end:true']);
    expect(bar().textContent).toContain('Try again');
  });

  it('a hold that heard nothing ends without words', async () => {
    const transcriber = fakeTranscriber();
    const onWords = vi.fn();
    const onHoldEnd = vi.fn();
    render(<TalkBar transcriber={transcriber} onWords={onWords} onHoldEnd={onHoldEnd} />);
    await press(1000);
    expect(onWords).not.toHaveBeenCalled();
    expect(onHoldEnd).toHaveBeenCalledWith({ cancelled: false, ended: 'release' });
  });
});

describe('useTalk, drawn by the caller', () => {
  it('gives the words so far and the state, and TalkBar takes it as `talk`', async () => {
    const transcriber = fakeTranscriber();
    const onWords = vi.fn();
    function Sheet() {
      const talk = useTalk({}, { transcriber, onWords });
      return (
        <>
          <p data-testid="words">{talk.transcript}</p>
          <TalkBar talk={talk} />
        </>
      );
    }
    render(<Sheet />);
    await down();
    act(() => transcriber.open());
    act(() => transcriber.yields('live words'));
    expect(screen.getByTestId('words').textContent).toBe('live words');
    await up();
    expect(onWords.mock.calls[0]![0]).toBe('live words');
  });
});

describe('useTalk, strictLang (mw-fu7dqf.3)', () => {
  it('starts the transcriber with the language and the flag', async () => {
    const transcriber = fakeTranscriber();
    const { result } = renderHook(() => useTalk({}, { transcriber, lang: 'el-GR', strictLang: true, onWords: () => {} }));
    await act(async () => {
      result.current.bar.onPointerDown({ pointerId: 1, pointerType: 'touch', currentTarget: { setPointerCapture: () => {} } } as never);
      await pass();
    });
    expect(transcriber.options).toEqual(expect.objectContaining({ lang: 'el-GR', strictLang: true }));
  });

  it('a hold given no strictLang starts the transcriber without it', async () => {
    const transcriber = fakeTranscriber();
    render(<TalkBar transcriber={transcriber} onWords={() => {}} />);
    await down();
    expect(transcriber.options?.strictLang).toBeFalsy();
  });

  it("the hold's failure carries the kind, and the notice names the language", async () => {
    const transcriber = fakeTranscriber();
    function Sheet() {
      const talk = useTalk({}, { transcriber, lang: 'el-GR', strictLang: true, onWords: () => {} });
      return (
        <>
          <p data-testid="kind">{talk.failure?.kind ?? 'none'}</p>
          <p data-testid="notice">{talk.notice ?? ''}</p>
          <TalkBar talk={talk} />
        </>
      );
    }
    render(<Sheet />);
    expect(screen.getByTestId('kind').textContent).toBe('none');
    await down();
    act(() => transcriber.fails({ kind: 'language-not-supported', code: 'language-not-supported', message: 'This phone cannot take dictation in el-GR' }));
    await pass();
    expect(screen.getByTestId('kind').textContent).toBe('language-not-supported');
    expect(screen.getByTestId('notice').textContent).toContain('el-GR');
    // a fresh hold clears it
    await down();
    expect(screen.getByTestId('kind').textContent).toBe('none');
  });

  it('through the real browserSpeech, a phone with no el-GR ends the hold with the kind and never makes an en-US recogniser', async () => {
    class NoGreek extends FakeRecognizer {
      start(track?: { label: string }) {
        super.start(track);
        queueMicrotask(() => this.onerror?.({ error: 'language-not-supported' }));
      }
    }
    vi.stubGlobal('SpeechRecognition', NoGreek);
    const kinds: (string | undefined)[] = [];
    function Sheet() {
      const talk = useTalk({}, { transcriber: browserSpeech, lang: 'el-GR', strictLang: true, onWords: () => {} });
      kinds.push(talk.failure?.kind);
      return <TalkBar talk={talk} />;
    }
    render(<Sheet />);
    await down();
    await pass();
    await pass();
    expect(kinds.at(-1)).toBe('language-not-supported');
    expect(FakeRecognizer.instances.map((r) => r.lang)).toEqual(['el-GR', 'el-GR']);
  });
});
