// @vitest-environment jsdom
// The Composer's extension points (mw-06ggew.12): what an app needs to plug its own features (drafts, saved prompts, quotes,
// shared-in files, a file viewer, a character limit) into the kit's Composer, every one additive, today's behaviour the default.
// The needs are Postern's hand-back on mw-06ggew.5 (items 1 to 6) and SpellForge's mw-06ggew.9 (the live count, the rows).
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Composer, forgetSilentInputs, type ComposerMessage, type ComposerProps } from '../src/index.js';
import { FakeRecognizer, clearInputs, installRecognizer } from './support/fakes.js';

const pass = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

let sent: ComposerMessage[] = [];
const onSend = vi.fn(async (message: ComposerMessage) => {
  sent.push(message);
  return true;
});

function open(props: Partial<ComposerProps> = {}) {
  return render(<Composer onSend={onSend} {...props} />);
}

const textBox = () => screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
const sendButton = () => screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
const type = (value: string) => fireEvent.change(textBox(), { target: { value } });
const ctrlEnter = () => fireEvent.keyDown(textBox(), { key: 'Enter', ctrlKey: true });
const picture = (name = 'photo.png') => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });

async function press() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
  await pass();
}
const hear = (text: string) => act(() => FakeRecognizer.instances.at(-1)?.hear(text));
async function letGo() {
  fireEvent.pointerUp(screen.getByRole('button', { name: /^(Release to send|Release to keep it in the box)$/ }), { clientX: 10, clientY: 10 });
  await pass();
  await pass();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  sent = [];
  onSend.mockClear();
  installRecognizer();
  clearInputs();
  forgetSilentInputs();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  URL.createObjectURL = (file: Blob | MediaSource) => `blob:${(file as File).name ?? 'preview'}`;
  URL.revokeObjectURL = () => {};
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('controlled text: text and onTextChange', () => {
  it('shows the text the app gives, and a draft that loads after mount fills the box', () => {
    const { rerender } = open({ mode: 'type', text: '' });
    expect(textBox().value).toBe('');
    rerender(<Composer onSend={onSend} mode="type" text="the draft from last time" />);
    expect(textBox().value).toBe('the draft from last time');
    expect(sendButton().disabled).toBe(false);
  });

  it('tells the app each change he types, and shows only what the app gives back', () => {
    const onTextChange = vi.fn();
    const { rerender } = open({ mode: 'type', text: 'abc', onTextChange });
    type('abcd');
    expect(onTextChange).toHaveBeenCalledWith('abcd');
    // the app did not take it: the box still shows its text
    expect(textBox().value).toBe('abc');
    rerender(<Composer onSend={onSend} mode="type" text="abcd" onTextChange={onTextChange} />);
    expect(textBox().value).toBe('abcd');
  });

  it('sends the controlled text, and asks the app to empty it when it went', async () => {
    const onTextChange = vi.fn();
    open({ mode: 'type', text: 'hello there', onTextChange });
    fireEvent.click(sendButton());
    await pass();
    expect(sent).toEqual([{ text: 'hello there', files: [] }]);
    expect(onTextChange).toHaveBeenLastCalledWith('');
  });

  it('keeps the words of a hold in an app-owned box (send by button)', async () => {
    function App() {
      const [text, setText] = useState('');
      return <Composer onSend={onSend} settings={{ send: 'button' }} text={text} onTextChange={setText} />;
    }
    render(<App />);
    await press();
    await hear('from the bar');
    await letGo();
    expect(sent).toEqual([]);
    expect(textBox().value).toBe('from the bar');
  });

  it('with only onTextChange the box stays the composer\'s own and the app hears every change (a draft saved as he types)', () => {
    const onTextChange = vi.fn();
    open({ mode: 'type', onTextChange });
    type('a');
    type('ab');
    expect(textBox().value).toBe('ab');
    expect(onTextChange.mock.calls).toEqual([['a'], ['ab']]);
  });
});

describe('onKeyDown, before the composer\'s own Enter', () => {
  it('is called first, and Enter still sends when it does nothing', async () => {
    const onKeyDown = vi.fn();
    open({ mode: 'type', onKeyDown });
    type('send me');
    ctrlEnter();
    await pass();
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([{ text: 'send me', files: [] }]);
  });

  it('keeps Enter from sending when it prevents the default: Tab takes a suggestion first', async () => {
    function App() {
      const [text, setText] = useState('/no');
      return (
        <Composer
          onSend={onSend}
          mode="type"
          text={text}
          onTextChange={setText}
          onKeyDown={(event) => {
            if (event.key === 'Tab' || event.key === 'Enter') {
              event.preventDefault();
              setText('/note ');
            }
          }}
        />
      );
    }
    render(<App />);
    fireEvent.keyDown(textBox(), { key: 'Tab' });
    expect(textBox().value).toBe('/note ');
    type('/no');
    ctrlEnter();
    await pass();
    expect(sent).toEqual([]);
    expect(textBox().value).toBe('/note ');
  });
});

describe('fieldOverlay', () => {
  it('is drawn with the text box, in a wrapper the app can lay it over', () => {
    open({ mode: 'type', fieldOverlay: <button type="button" data-testid="grey-suggestion">/note</button> });
    const overlay = screen.getByTestId('grey-suggestion');
    expect(overlay.parentElement).toBe(textBox().parentElement);
    expect(overlay.parentElement?.className).toContain('bk-composer__field-wrap');
  });

  it('is not drawn while the bar is out', () => {
    open({ fieldOverlay: <button type="button" data-testid="grey-suggestion">/note</button> });
    expect(screen.queryByTestId('grey-suggestion')).toBeNull();
  });

  it('leaves the box as it was when there is none: the text box keeps its place when the overlay comes and goes', () => {
    const { rerender } = open({ mode: 'type' });
    const before = textBox();
    rerender(<Composer onSend={onSend} mode="type" fieldOverlay={<i data-testid="o" />} />);
    expect(textBox()).toBe(before);
    expect(screen.getByTestId('o')).toBeTruthy();
  });
});

describe('sendBlocked and renderSend', () => {
  it('sendBlocked greys Send, and Enter does not send either', async () => {
    open({ mode: 'type', sendBlocked: true });
    type('checking the prompts');
    expect(sendButton().disabled).toBe(true);
    ctrlEnter();
    await pass();
    expect(sent).toEqual([]);
  });

  it('sendBlocked greys the arrow beside the bar too', async () => {
    open({ settings: { attach: true }, sendBlocked: true });
    await act(async () => {
      fireEvent.change(document.querySelector('input[type="file"][multiple]') as HTMLInputElement, { target: { files: [picture()] } });
    });
    await pass();
    expect(sendButton().disabled).toBe(true);
  });

  it('a release while sendBlocked keeps the words in the box instead of sending them', async () => {
    open({ sendBlocked: true });
    await press();
    await hear('hold on to this');
    await letGo();
    expect(sent).toEqual([]);
    expect(textBox().value).toBe('hold on to this');
    expect(sendButton().disabled).toBe(true);
  });

  it('renderSend replaces the Send button, and its send() goes past sendBlocked', async () => {
    const seen: unknown[] = [];
    open({
      mode: 'type',
      sendBlocked: true,
      renderSend: (slot) => {
        seen.push(slot);
        return (
          <button type="button" data-testid="send-force" disabled={!slot.canSend || slot.busy} onClick={slot.send}>
            Send (hold to send anyway)
          </button>
        );
      },
    });
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect((screen.getByTestId('send-force') as HTMLButtonElement).disabled).toBe(true);
    type('send it anyway');
    expect(seen.at(-1)).toMatchObject({ canSend: true, blocked: true, busy: false, disabled: false, label: 'Send', placement: 'field' });
    fireEvent.click(screen.getByTestId('send-force'));
    await pass();
    expect(sent).toEqual([{ text: 'send it anyway', files: [] }]);
  });

  it('renderSend replaces the arrow beside the bar, with placement "bar"', async () => {
    const renderSend = vi.fn((slot: { placement: string; send: () => void }) => (
      <button type="button" data-testid="mine" onClick={slot.send}>
        mine
      </button>
    ));
    open({ settings: { attach: true }, renderSend });
    await act(async () => {
      fireEvent.change(document.querySelector('input[type="file"][multiple]') as HTMLInputElement, { target: { files: [picture()] } });
    });
    await pass();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(renderSend.mock.calls.at(-1)?.[0].placement).toBe('bar');
    fireEvent.click(screen.getByTestId('mine'));
    await pass();
    expect(sent).toHaveLength(1);
  });
});

describe('canSendEmpty', () => {
  it('lets Send go with no words and no files (a quote alone)', async () => {
    open({ mode: 'type', canSendEmpty: true });
    expect(sendButton().disabled).toBe(false);
    fireEvent.click(sendButton());
    await pass();
    expect(sent).toEqual([{ text: '', files: [] }]);
  });

  it('shows Send in the speak layout before anything is typed, and Enter sends', async () => {
    open({ open: 'box', canSendEmpty: true });
    expect(sendButton().disabled).toBe(false);
    ctrlEnter();
    await pass();
    expect(sent).toEqual([{ text: '', files: [] }]);
  });

  it('is off by default: nothing to send, nothing goes', async () => {
    open({ mode: 'type' });
    expect(sendButton().disabled).toBe(true);
    ctrlEnter();
    await pass();
    expect(sent).toEqual([]);
  });
});

describe('files that arrive after mount: incomingFiles', () => {
  it('join the file row, and go with the message', async () => {
    const { rerender } = open({ mode: 'type', incomingFiles: [] });
    expect(screen.queryByRole('group', { name: 'To send' })).toBeNull();
    const shared = [picture('shared.png')];
    await act(async () => {
      rerender(<Composer onSend={onSend} mode="type" incomingFiles={shared} />);
    });
    await pass();
    expect(screen.getByRole('img', { name: 'shared.png' })).toBeTruthy();
    fireEvent.click(sendButton());
    await pass();
    expect(sent).toHaveLength(1);
    expect(sent[0].files.map((file) => file.name)).toEqual(['shared.png']);
  });

  it('are added once, however often the composer draws again with the same list', async () => {
    const shared = [picture('shared.png')];
    const { rerender } = open({ mode: 'type', incomingFiles: shared });
    await pass();
    rerender(<Composer onSend={onSend} mode="type" incomingFiles={shared} text="x" />);
    await pass();
    expect(screen.getAllByRole('img', { name: 'shared.png' })).toHaveLength(1);
  });

  it('are put to the app\'s refuseFile like any other', async () => {
    const onNotice = vi.fn();
    open({ mode: 'type', incomingFiles: [picture('big.png')], refuseFile: () => 'Too big.', onNotice });
    await pass();
    expect(screen.queryByRole('img', { name: 'big.png' })).toBeNull();
    expect(onNotice).toHaveBeenCalledWith('Too big.');
  });

  it('a second list adds to the first', async () => {
    const { rerender } = open({ mode: 'type', incomingFiles: [picture('one.png')] });
    await pass();
    await act(async () => {
      rerender(<Composer onSend={onSend} mode="type" incomingFiles={[picture('two.png')]} />);
    });
    await pass();
    expect(screen.getByRole('img', { name: 'one.png' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'two.png' })).toBeTruthy();
  });
});

describe('onFileTap', () => {
  it('a tap on a waiting picture gives the app the file and its preview URL', async () => {
    const onFileTap = vi.fn();
    open({ mode: 'type', incomingFiles: [picture('screenshot.png')], onFileTap });
    await pass();
    fireEvent.click(screen.getByRole('button', { name: 'View screenshot.png' }));
    expect(onFileTap).toHaveBeenCalledWith(expect.objectContaining({ name: 'screenshot.png', type: 'image/png', preview: 'blob:screenshot.png' }));
  });

  it('a file that is not a picture can be tapped too, and the words on the button are the app\'s (labels.view)', async () => {
    const onFileTap = vi.fn();
    open({ mode: 'type', incomingFiles: [new File(['hello'], 'notes.txt', { type: 'text/plain' })], onFileTap, labels: { view: (name) => `Open ${name}` } });
    await pass();
    fireEvent.click(screen.getByRole('button', { name: 'Open notes.txt' }));
    expect(onFileTap).toHaveBeenCalledWith(expect.objectContaining({ name: 'notes.txt', type: 'text/plain' }));
    expect(onFileTap.mock.calls[0][0].preview).toBeUndefined();
  });

  it('without it a waiting file is not a button, as before', async () => {
    open({ mode: 'type', incomingFiles: [picture('screenshot.png')] });
    await pass();
    expect(screen.queryByRole('button', { name: 'View screenshot.png' })).toBeNull();
    expect(screen.getByRole('img', { name: 'screenshot.png' })).toBeTruthy();
  });
});

describe("open: 'box' | 'bar', which comes first in the speak layout", () => {
  it("'box' opens on the text box with attach and camera beside it, the mic standing in for Send", () => {
    open({ open: 'box', settings: { attach: true, camera: true } });
    expect(screen.queryByRole('button', { name: 'Hold to talk' })).toBeNull();
    const box = textBox();
    const mic = screen.getByRole('button', { name: 'Speak a message' });
    const attach = screen.getByRole('button', { name: 'Attach files' });
    expect(attach.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(box.compareDocumentPosition(mic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // nothing to send yet: no Send button, the mic stands where it will be
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    type('something');
    expect(sendButton()).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Speak a message' })).toBeNull();
  });

  it('the mic brings the bar out', () => {
    open({ open: 'box' });
    fireEvent.click(screen.getByRole('button', { name: 'Speak a message' }));
    expect(screen.getByRole('button', { name: 'Hold to talk' })).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('after a send it goes back to the box', async () => {
    open({ open: 'box' });
    type('hello');
    fireEvent.click(sendButton());
    await pass();
    expect(sent).toEqual([{ text: 'hello', files: [] }]);
    expect(textBox().value).toBe('');
    expect(screen.queryByRole('button', { name: 'Hold to talk' })).toBeNull();
  });

  it("changing it to 'bar' after mount brings the bar out (a share with no words)", () => {
    const { rerender } = open({ open: 'box' });
    expect(screen.queryByRole('button', { name: 'Hold to talk' })).toBeNull();
    rerender(<Composer onSend={onSend} open="bar" />);
    expect(screen.getByRole('button', { name: 'Hold to talk' })).toBeTruthy();
  });

  it("'bar' is the speak layout's default, and with the mic off the box is all there is", () => {
    open({ open: 'bar' });
    expect(screen.getByRole('button', { name: 'Hold to talk' })).toBeTruthy();
    cleanup();
    open({ open: 'bar', settings: { talk: 'off' } });
    expect(screen.queryByRole('button', { name: 'Hold to talk' })).toBeNull();
    expect(textBox()).toBeTruthy();
  });
});

describe('maxLength and minRows', () => {
  it("shows a live 'N of M' count under the box", () => {
    open({ mode: 'type', maxLength: 1000 });
    expect(screen.getByTestId('composer-count').textContent).toBe('0 of 1000');
    type('hello');
    expect(screen.getByTestId('composer-count').textContent).toBe('5 of 1000');
    expect(screen.getByTestId('composer-count').getAttribute('data-over')).toBeNull();
  });

  it('greys Send when the text is over, and Enter does not send; back under, Send is back', async () => {
    open({ mode: 'type', maxLength: 5 });
    type('123456');
    expect(screen.getByTestId('composer-count').textContent).toBe('6 of 5');
    expect(screen.getByTestId('composer-count').getAttribute('data-over')).toBe('true');
    expect(sendButton().disabled).toBe(true);
    ctrlEnter();
    await pass();
    expect(sent).toEqual([]);
    type('12345');
    expect(sendButton().disabled).toBe(false);
    ctrlEnter();
    await pass();
    expect(sent).toEqual([{ text: '12345', files: [] }]);
  });

  it('does not cut what is typed or pasted: over is shown, not forbidden', () => {
    open({ mode: 'type', maxLength: 3 });
    type('a long message');
    expect(textBox().value).toBe('a long message');
    expect(textBox().maxLength).toBe(-1);
  });

  it('counts the app-owned text, and the words of a label the app words (labels.count)', () => {
    open({ mode: 'type', maxLength: 10, text: 'abcd', labels: { count: (n, max) => `${n}/${max} characters` } });
    expect(screen.getByTestId('composer-count').textContent).toBe('4/10 characters');
  });

  it('shows no count without maxLength', () => {
    open({ mode: 'type' });
    expect(screen.queryByTestId('composer-count')).toBeNull();
  });

  it('minRows sets the box\'s rows; the default is one', () => {
    open({ mode: 'type', minRows: 8 });
    expect(textBox().rows).toBe(8);
    cleanup();
    open({ mode: 'type' });
    expect(textBox().rows).toBe(1);
  });
});
