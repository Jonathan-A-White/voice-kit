// @vitest-environment jsdom
// ComposerSettings (mw-06ggew.2): ONE settings object (talk, send, type, attach, camera, voiceNote, lang) drives the
// Composer and the HoldToTalkBar. talk 'tap' latches the mic on after a press shorter than LATCH_MS (whisper-hid's
// talkPress model), the next tap stops it; send 'button' leaves the words in the box for a Send. The old props are the
// fallbacks.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  Composer,
  DEFAULT_COMPOSER_SETTINGS,
  HoldToTalkBar,
  LATCH_MS,
  resolveSettings,
  type ComposerMessage,
  type ComposerProps,
} from '../src/index.js';
import { FakeRecognizer, clearInputs, fakeTranscriber, installRecognizer } from './support/fakes.js';

const pass = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

let sent: ComposerMessage[] = [];
const onSend = vi.fn(async (message: ComposerMessage) => {
  sent.push(message);
  return true;
});

function open(props: Partial<ComposerProps> = {}) {
  return render(<Composer onSend={onSend} {...props} />);
}

const BAR = /^(Hold to talk|Try again|Release to send|Release to keep it in the box|Tap to stop|Let go to keep it unsent|Starting the mic…)$/;
const bar = () => screen.getByRole('button', { name: BAR });
const textBox = () => screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;

async function down() {
  fireEvent.pointerDown(bar());
  await pass();
}
async function up() {
  fireEvent.pointerUp(bar(), { clientX: 10, clientY: 10 });
  await pass();
  await pass();
}
/** A press and release `ms` apart. */
async function press(ms: number) {
  await down();
  await pass(ms);
  await up();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  sent = [];
  onSend.mockClear();
  installRecognizer();
  clearInputs();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  URL.createObjectURL = () => 'blob:preview';
  URL.revokeObjectURL = () => {};
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('resolveSettings', () => {
  it('has the defaults: hold, release, type on, attach, camera and voice note off', () => {
    expect(DEFAULT_COMPOSER_SETTINGS).toEqual({ talk: 'hold', send: 'release', type: true, attach: false, camera: false, voiceNote: false });
    expect(resolveSettings({})).toMatchObject(DEFAULT_COMPOSER_SETTINGS);
    expect(resolveSettings({}).mode).toBe('speak');
  });

  it('takes the old props as the fallbacks: mode, attach, camera, recordVoice, lang', () => {
    expect(resolveSettings({ mode: 'type', attach: true, camera: true, recordVoice: true, lang: 'fr' })).toMatchObject({
      mode: 'type',
      attach: true,
      camera: true,
      voiceNote: true,
      lang: 'fr',
    });
  });

  it('lets a setting win over the old prop that says the same', () => {
    const settings = { attach: false, voiceNote: false, lang: 'de', talk: 'tap', send: 'button' } as const;
    expect(resolveSettings({ settings, attach: true, recordVoice: true, lang: 'fr' })).toMatchObject(settings);
  });

  it('keeps the text box reachable: type cannot be off when talk is off, and type-first needs typing', () => {
    expect(resolveSettings({ settings: { talk: 'off', type: false } }).type).toBe(true);
    expect(resolveSettings({ mode: 'type', settings: { type: false } }).mode).toBe('speak');
    expect(resolveSettings({ mode: 'type', settings: { talk: 'off' } }).mode).toBe('type');
  });
});

describe('talk and send, each combination', () => {
  it('talk hold, send release: a hold sends on release, as before', async () => {
    const transcriber = fakeTranscriber();
    open({ transcriber, settings: { talk: 'hold', send: 'release' } });
    await down();
    act(() => transcriber.open());
    act(() => transcriber.yields('hello there'));
    await pass(100);
    await up();
    expect(sent).toEqual([{ text: 'hello there', files: [] }]);
  });

  it('talk hold, send button: letting go leaves the words in the box, nothing selected, and Send sends them (fixed)', async () => {
    const transcriber = fakeTranscriber();
    open({ transcriber, settings: { send: 'button' } });
    await down();
    act(() => transcriber.open());
    expect(bar().textContent).toContain('Release to keep it in the box');
    act(() => transcriber.yields('hello thre'));
    await pass(1000);
    await up();
    expect(sent).toEqual([]);
    expect(textBox().value).toBe('hello thre');
    expect(textBox().selectionStart).toBe(textBox().value.length);
    expect(textBox().selectionEnd).toBe(textBox().value.length);
    fireEvent.change(textBox(), { target: { value: 'hello there' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await pass();
    expect(sent).toEqual([{ text: 'hello there', files: [] }]);
  });

  it('talk tap, send release: a quick tap latches the mic on, the next tap stops it and sends', async () => {
    const transcriber = fakeTranscriber();
    open({ transcriber, settings: { talk: 'tap' } });
    await press(LATCH_MS - 50);
    expect(transcriber.started).toBe(1);
    expect(transcriber.stopped).toBe(false);
    act(() => transcriber.open());
    expect(bar().textContent).toContain('Tap to stop');
    expect(bar().getAttribute('data-state')).toBe('latched');
    act(() => transcriber.yields('keep it on'));
    await pass(5000);
    expect(transcriber.stopped).toBe(false);
    await press(50);
    expect(transcriber.stopped).toBe(true);
    expect(sent).toEqual([{ text: 'keep it on', files: [] }]);
    expect(bar().textContent).toContain('Hold to talk');
  });

  it('talk tap, send button: stopping a latched listen puts the words in the box and Send sends them', async () => {
    const transcriber = fakeTranscriber();
    open({ transcriber, settings: { talk: 'tap', send: 'button' } });
    await press(100);
    act(() => transcriber.open());
    act(() => transcriber.yields('fix me'));
    await press(80);
    expect(transcriber.stopped).toBe(true);
    expect(sent).toEqual([]);
    expect(textBox().value).toBe('fix me');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await pass();
    expect(sent).toEqual([{ text: 'fix me', files: [] }]);
  });
});

describe('talk tap', () => {
  it('a press of LATCH_MS or longer is a hold: letting go stops it', async () => {
    const transcriber = fakeTranscriber();
    open({ transcriber, settings: { talk: 'tap' } });
    await down();
    act(() => transcriber.open());
    act(() => transcriber.yields('a long hold'));
    await pass(LATCH_MS);
    await up();
    expect(transcriber.stopped).toBe(true);
    expect(sent).toEqual([{ text: 'a long hold', files: [] }]);
    expect(bar().textContent).toContain('Hold to talk');
  });

  it('sliding off a latched press (second tap) cancels and keeps the words unsent', async () => {
    const transcriber = fakeTranscriber();
    open({ transcriber, settings: { talk: 'tap' } });
    await press(100);
    act(() => transcriber.open());
    act(() => transcriber.yields('never mind'));
    await down();
    vi.spyOn(bar(), 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 300, bottom: 96, width: 300, height: 96, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.pointerMove(bar(), { clientX: 600, clientY: 10 });
    expect(bar().textContent).toContain('Let go to keep it unsent');
    fireEvent.pointerUp(bar(), { clientX: 600, clientY: 10 });
    await pass();
    expect(transcriber.aborted).toBe(true);
    expect(sent).toEqual([]);
    expect(textBox().value).toBe('never mind');
  });

  it('the bar tells the reader how to stop, and the hint says tap', async () => {
    open({ transcriber: fakeTranscriber(), settings: { talk: 'tap' } });
    expect(screen.getByText(/tap it/i)).toBeTruthy();
  });

  it('works from the keyboard too: a quick Space latches, the next Space stops', async () => {
    const transcriber = fakeTranscriber();
    open({ transcriber, settings: { talk: 'tap' } });
    fireEvent.keyDown(bar(), { key: ' ' });
    await pass(50);
    fireEvent.keyUp(bar(), { key: ' ' });
    await pass();
    act(() => transcriber.open());
    expect(bar().textContent).toContain('Tap to stop');
    act(() => transcriber.yields('by key'));
    fireEvent.keyDown(bar(), { key: ' ' });
    fireEvent.keyUp(bar(), { key: ' ' });
    await pass();
    await pass();
    expect(sent).toEqual([{ text: 'by key', files: [] }]);
  });

  it('talk hold never latches: a quick press stops it at once', async () => {
    const transcriber = fakeTranscriber();
    open({ transcriber });
    await press(50);
    expect(transcriber.stopped).toBe(true);
  });
});

describe('talk off', () => {
  it('shows no mic: no bar, no mic button, and the text box with Send are there', () => {
    open({ settings: { talk: 'off' } });
    expect(screen.queryByRole('button', { name: BAR })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Speak a message' })).toBeNull();
    expect(textBox()).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('shows no mic in type-first mode either', () => {
    open({ mode: 'type', settings: { talk: 'off' } });
    expect(screen.queryByRole('button', { name: 'Speak a message' })).toBeNull();
  });

  it('the HoldToTalkBar alone renders nothing', () => {
    const { container } = render(<HoldToTalkBar label="Hold" listening={false} disabled={false} onPress={() => {}} onRelease={() => {}} onAbort={() => {}} settings={{ talk: 'off' }} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('the settings drive the rest of the composer', () => {
  it('attach and camera show from settings, and not by default', () => {
    const { container, rerender } = open();
    expect(screen.queryByRole('button', { name: 'Attach files' })).toBeNull();
    rerender(<Composer onSend={onSend} settings={{ attach: true, camera: true }} />);
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeTruthy();
    expect(container.querySelector('input[capture]')).toBeTruthy();
  });

  it('type false takes away the Type a message button', () => {
    open({ settings: { type: false } });
    expect(screen.queryByRole('button', { name: 'Type a message' })).toBeNull();
    expect(bar()).toBeTruthy();
  });

  it('voiceNote from settings records the hold as a voice note (as recordVoice does)', async () => {
    // the voice is recorded only when the page can record; here it cannot (jsdom has no MediaRecorder), so the words still go alone
    const transcriber = fakeTranscriber();
    open({ transcriber, settings: { voiceNote: true } });
    await down();
    act(() => transcriber.open());
    act(() => transcriber.yields('plain words'));
    await up();
    expect(sent).toEqual([{ text: 'plain words', files: [] }]);
  });

  it('lang from settings is the language the recogniser listens for', async () => {
    open({ settings: { lang: 'fr-FR' } });
    await down();
    expect(FakeRecognizer.instances.at(-1)?.lang).toBe('fr-FR');
  });
});

describe('the old props still work, as the fallbacks', () => {
  it('mode, attach, camera, recordVoice and lang behave without a settings object', async () => {
    const { container } = open({ mode: 'type', attach: true, camera: true, recordVoice: true, lang: 'fr-FR' });
    expect(container.querySelector('.bk-composer')?.getAttribute('data-mode')).toBe('type');
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take a photo' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Speak a message' }));
    await down();
    expect(FakeRecognizer.instances.at(-1)?.lang).toBe('fr-FR');
  });

  it('the old defaults hold: hold to talk, a release sends', async () => {
    const transcriber = fakeTranscriber();
    open({ transcriber });
    await down();
    act(() => transcriber.open());
    act(() => transcriber.yields('as ever'));
    await up();
    expect(sent).toEqual([{ text: 'as ever', files: [] }]);
  });
});
