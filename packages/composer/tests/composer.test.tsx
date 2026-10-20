// @vitest-environment jsdom
// The Composer: hold the bar and the words stream on the screen, let go and they are sent, slide off and they
// wait in the box unsent; a long dictation is never dropped; a silent first input falls back to the next;
// 'speak' puts the bar first and 'type' the text box and Send; attach and camera show only when asked for.
// Postern's scenarios (features/composer-hold-to-talk.feature, AC-1 to AC-17) are the specification.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Composer, INPUT_SILENT_MS, STOP_TIMEOUT_MS, forgetSilentInputs, type ComposerMessage, type ComposerProps } from '../src/index.js';
import { FakeMediaRecorder, FakeMediaStream, FakeRecognizer, clearInputs, fakeTranscriber, installRecognizer, opened, setInputs } from './support/fakes.js';

/** Lets the hold's promises and the recogniser's microtasks run, and the fake clock move on by `ms`. */
const pass = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

let sent: ComposerMessage[] = [];
const onSend = vi.fn(async (message: ComposerMessage) => {
  sent.push(message);
  return true;
});

function open(props: Partial<ComposerProps> = {}) {
  return render(<Composer onSend={onSend} {...props} />);
}

const BAR = /^(Hold to talk|Try again|Release to send|Let go to keep it unsent|Starting the mic…)$/;
const bar = () => screen.getByRole('button', { name: BAR });
const textBox = () => screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
const live = () => screen.getByTestId('live-transcript').textContent;

/** jsdom has no layout: the bar is 300 x 96 at the origin, so (10, 10) is on it and (600, 10) is off it. */
const ON = { clientX: 10, clientY: 10 };
const OFF = { clientX: 600, clientY: 10 };
function giveTheBarAShape() {
  vi.spyOn(bar(), 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, right: 300, bottom: 96, width: 300, height: 96, x: 0, y: 0, toJSON: () => ({}) });
}

async function press() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
  await pass();
  giveTheBarAShape();
}

const hear = (text: string) => act(() => FakeRecognizer.instances.at(-1)?.hear(text));

async function letGo(where = ON) {
  fireEvent.pointerUp(bar(), where);
  await pass();
  await pass();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  sent = [];
  onSend.mockClear();
  installRecognizer();
  clearInputs();
  forgetSilentInputs();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  // jsdom has no object URLs; the previews only need a string
  URL.createObjectURL = () => 'blob:preview';
  URL.revokeObjectURL = () => {};
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('holding the bar, with a transcriber the app passes in', () => {
  it('starts recording on the hold, shows the words as the transcriber yields them, and sends them on release', async () => {
    const transcriber = fakeTranscriber();
    open({ transcriber });
    await press();
    expect(transcriber.started).toBe(1);
    expect(bar().textContent).toContain('Starting the mic…');
    act(() => transcriber.open());
    expect(bar().textContent).toContain('Release to send');
    expect(live()).toBe('Listening…');
    act(() => transcriber.yields('check'));
    expect(live()).toBe('check');
    act(() => transcriber.yields('check the build'));
    expect(live()).toBe('check the build');
    await letGo();
    expect(transcriber.stopped).toBe(true);
    expect(sent).toEqual([{ text: 'check the build', files: [] }]);
  });

  it('sends the words that were made out and says what could not be (mw-06ggew.1): to the app when it takes notices', async () => {
    const transcriber = fakeTranscriber();
    transcriber.missedNote = 'The words after the pause could not be made out (the speech service failed: network).';
    const onNotice = vi.fn();
    open({ transcriber, onNotice });
    await press();
    act(() => transcriber.open());
    act(() => transcriber.yields('before the pause'));
    await letGo();
    expect(sent).toEqual([{ text: 'before the pause', files: [] }]);
    expect(onNotice).toHaveBeenCalledWith(transcriber.missedNote);
  });

  it('shows the missed-words notice above the bar when the app takes none', async () => {
    const transcriber = fakeTranscriber();
    transcriber.missedNote = 'The words after the pause could not be made out (the speech service failed: network).';
    open({ transcriber });
    await press();
    act(() => transcriber.open());
    act(() => transcriber.yields('before the pause'));
    await letGo();
    expect(sent).toEqual([{ text: 'before the pause', files: [] }]);
    expect(screen.getByText(transcriber.missedNote)).toBeTruthy();
  });

  it('says nothing of missed words when the hold was clean', async () => {
    const transcriber = fakeTranscriber();
    const onNotice = vi.fn();
    open({ transcriber, onNotice });
    await press();
    act(() => transcriber.open());
    act(() => transcriber.yields('all of it'));
    await letGo();
    expect(onNotice).not.toHaveBeenCalled();
  });

  it('keeps the words unsent in the box when the finger slides off the bar before letting go', async () => {
    const transcriber = fakeTranscriber();
    open({ transcriber });
    await press();
    act(() => transcriber.open());
    act(() => transcriber.yields('never mind'));
    fireEvent.pointerMove(bar(), OFF);
    expect(bar().textContent).toContain('Let go to keep it unsent');
    await letGo(OFF);
    expect(transcriber.aborted).toBe(true);
    expect(sent).toEqual([]);
    expect(textBox().value).toBe('never mind');
    expect(screen.getByText('Kept what you said: tap Send.')).toBeTruthy();
  });

  it('never drops a long dictation: words yielded over 70 seconds of holding are all sent', async () => {
    const transcriber = fakeTranscriber();
    open({ transcriber });
    await press();
    act(() => transcriber.open());
    const words: string[] = [];
    for (let second = 0; second < 70; second += 5) {
      words.push(`word${second}`);
      act(() => transcriber.yields(words.join(' ')));
      await pass(5_000);
    }
    expect(bar().textContent).toContain('Release to send');
    await letGo();
    expect(sent).toEqual([{ text: words.join(' '), files: [] }]);
  });
});

describe("holding the bar on the browser's speech recogniser (Postern's scenarios)", () => {
  it('AC-2: while he holds the bar his words stream on the screen', async () => {
    open();
    await press();
    expect(FakeRecognizer.instances).toHaveLength(1);
    await hear('check the build');
    expect(live()).toBe('check the build');
    expect(bar().textContent).toContain('Release to send');
  });

  it('AC-3: letting go sends the words, and the voice note when the app asks for one', async () => {
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('MediaStream', FakeMediaStream);
    // a browser that cannot list its inputs records the default microphone
    const getUserMedia = vi.fn(() => Promise.resolve(new FakeMediaStream([{ stop: () => {} }])));
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true, writable: true });
    open({ recordVoice: true });
    await press();
    await hear('check the build');
    await letGo();
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe('check the build');
    expect(sent[0].files).toHaveLength(1);
    expect(sent[0].files[0]).toMatchObject({ type: 'audio/webm' });
    expect(sent[0].files[0].name).toMatch(/^voice-.*\.webm$/);
  });

  it('AC-5: sliding off says Let go to keep it unsent, and nothing is sent; the words wait in the box', async () => {
    open();
    await press();
    await hear('never mind');
    fireEvent.pointerMove(bar(), OFF);
    expect(bar().textContent).toContain('Let go to keep it unsent');
    await letGo(OFF);
    expect(sent).toEqual([]);
    expect(textBox().value).toBe('never mind');
  });

  it('AC-6: sliding back onto the bar before letting go still sends', async () => {
    open();
    await press();
    await hear('kept it');
    fireEvent.pointerMove(bar(), OFF);
    fireEvent.pointerMove(bar(), ON);
    expect(bar().textContent).toContain('Release to send');
    await letGo();
    expect(sent).toEqual([{ text: 'kept it', files: [] }]);
  });

  it('AC-9: a hold with no words heard sends nothing and says so', async () => {
    open();
    await press();
    await letGo();
    expect(sent).toEqual([]);
    expect(screen.getByText('No speech was heard.')).toBeTruthy();
  });

  it('AC-13: a hold the phone takes the touch from keeps the words unsent, and one tap of Send sends them', async () => {
    open();
    await press();
    await hear('the build is red on main');
    fireEvent.pointerCancel(bar());
    await pass();
    expect(sent).toEqual([]);
    expect(textBox().value).toBe('the build is red on main');
    expect(screen.getByText('Kept what you said: tap Send.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await pass();
    expect(sent).toEqual([{ text: 'the build is red on main', files: [] }]);
    expect(screen.queryByText('Kept what you said: tap Send.')).toBeNull();
  });

  it('AC-14: the app going to the background mid-hold keeps the words heard so far, unsent', async () => {
    open();
    await press();
    await hear('remember the release notes');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(FakeRecognizer.instances.at(-1)?.aborted).toBe(true);
    expect(sent).toEqual([]);
    expect(textBox().value).toBe('remember the release notes');
    expect(screen.getByText('Kept what you said: tap Send.')).toBeTruthy();
  });

  it('AC-15: the recogniser failing mid-hold keeps the words, unsent, and says why', async () => {
    open();
    await press();
    await hear('the deploy went fine');
    await act(async () => FakeRecognizer.instances.at(-1)?.onerror?.({ error: 'audio-capture' }));
    expect(screen.queryByRole('button', { name: BAR })).toBeNull();
    expect(sent).toEqual([]);
    expect(textBox().value).toBe('the deploy went fine');
    expect(screen.getByText('Kept what you said: tap Send.')).toBeTruthy();
    expect(screen.getByText(/No microphone was found\./)).toBeTruthy();
  });

  it('AC-16: a release the recogniser settles with a blank final keeps the words it showed, unsent', async () => {
    FakeRecognizer.blankFinal = true;
    open();
    await press();
    await hear('ship it tonight');
    expect(live()).toBe('ship it tonight');
    await letGo();
    expect(sent).toEqual([]);
    expect(textBox().value).toBe('ship it tonight');
    expect(screen.getByText('Kept what you said: tap Send.')).toBeTruthy();
  });

  it('AC-17: a 3-minute hold the recogniser ends twice by itself keeps every word, and letting go sends them all', async () => {
    open();
    await press();
    await hear('first the build');
    for (const later of ['then the tests', 'then the landing']) {
      vi.setSystemTime(Date.now() + 90_000);
      await act(async () => FakeRecognizer.instances.at(-1)?.onend?.());
      await pass();
      expect(bar().textContent).toMatch(/Release to send|Starting the mic…/);
      await hear(later);
    }
    expect(live()).toBe('first the build then the tests then the landing');
    await letGo();
    expect(FakeRecognizer.instances).toHaveLength(3);
    expect(sent).toEqual([{ text: 'first the build then the tests then the landing', files: [] }]);
  });

  it('keeps the words in the box when the app could not send them', async () => {
    onSend.mockImplementationOnce(async () => false);
    open();
    await press();
    await hear('try again later');
    await letGo();
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(textBox().value).toBe('try again later');
  });
});

describe('a silent first input falls back to the next (mw-f7gmps.1)', () => {
  const EARBUDS = [
    { deviceId: 'phone', label: 'Phone microphone' },
    { deviceId: 'buds', label: 'Bluetooth headset' },
  ];

  it(`AC-10: earbuds that give no words within ${INPUT_SILENT_MS} ms are let go while he holds, and what he says after reaches the message`, async () => {
    setInputs(EARBUDS);
    open();
    await press();
    await pass();
    expect(FakeRecognizer.instances.at(-1)?.startedWith?.label).toBe('Bluetooth headset');
    expect(screen.getByTestId('mic-name').textContent).toBe('Listening on the Bluetooth microphone: Bluetooth headset.');
    await pass(INPUT_SILENT_MS + 100);
    expect(FakeRecognizer.instances.length).toBeGreaterThan(1);
    expect(FakeRecognizer.instances.at(-1)?.startedWith).toBeUndefined();
    expect(screen.getByTestId('mic-name').textContent).toBe("Listening on the phone's own microphone.");
    expect(bar().textContent).toMatch(/Release to send|Starting the mic…/);
    await hear('check the build');
    await letGo();
    expect(sent).toEqual([{ text: 'check the build', files: [] }]);
  });

  it('AC-11: the earbuds that heard nothing are not chosen again; the next hold starts on the default microphone at once', async () => {
    setInputs(EARBUDS);
    open();
    await press();
    await pass();
    await pass(INPUT_SILENT_MS + 100);
    await hear('first');
    await letGo();
    expect(sent).toHaveLength(1);
    opened.length = 0;
    FakeRecognizer.instances = [];
    await press();
    await pass();
    expect(FakeRecognizer.instances).toHaveLength(1);
    expect(FakeRecognizer.instances[0].startedWith).toBeUndefined();
    expect(opened).not.toContain('buds');
  });
});

describe("the layout: 'speak' puts the bar first, 'type' the text box and Send", () => {
  it("mode 'speak' (the default) shows the hold bar first and the text box only after Type a message", async () => {
    const { container } = open({ attach: true, camera: true });
    expect(container.querySelector('.bk-composer')?.getAttribute('data-mode')).toBe('speak');
    const holdBar = screen.getByRole('button', { name: 'Hold to talk' });
    expect(screen.queryByRole('textbox')).toBeNull();
    const typeInstead = screen.getByRole('button', { name: 'Type a message' });
    // the bar comes before the quiet row of attach, camera and Type a message
    expect(holdBar.compareDocumentPosition(typeInstead) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(holdBar.compareDocumentPosition(screen.getByRole('button', { name: 'Attach files' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(typeInstead);
    expect(screen.queryByRole('button', { name: 'Hold to talk' })).toBeNull();
    expect(document.activeElement).toBe(textBox());
  });

  it("mode 'type' shows the text box and Send first, with a small mic button that opens the bar", async () => {
    open({ mode: 'type' });
    expect(screen.queryByRole('button', { name: 'Hold to talk' })).toBeNull();
    const box = textBox();
    const send = screen.getByRole('button', { name: 'Send' });
    const mic = screen.getByRole('button', { name: 'Speak a message' });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    expect(mic.className).toContain('bk-composer__mic');
    expect(box.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(box, { target: { value: 'look at this' } });
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await pass();
    expect(sent).toEqual([{ text: 'look at this', files: [] }]);
    expect(textBox().value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Speak a message' }));
    expect(screen.getByRole('button', { name: 'Hold to talk' })).toBeTruthy();
  });

  it("goes back to the bar after a send in 'speak' mode, and stays on the text box in 'type' mode", async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Type a message' }));
    fireEvent.change(textBox(), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await pass();
    expect(sent).toEqual([{ text: 'hello', files: [] }]);
    expect(screen.getByRole('button', { name: 'Hold to talk' })).toBeTruthy();
    cleanup();
    open({ mode: 'type' });
    fireEvent.click(screen.getByRole('button', { name: 'Speak a message' }));
    await press();
    await hear('from the bar');
    await letGo();
    expect(sent).toEqual([
      { text: 'hello', files: [] },
      { text: 'from the bar', files: [] },
    ]);
    expect(screen.queryByRole('button', { name: 'Hold to talk' })).toBeNull();
    expect(textBox().value).toBe('');
  });

  it('takes its words from the app: Hold to ask, Type a question', () => {
    open({ labels: { hold: 'Hold to ask', typeInstead: 'Type a question', placeholder: 'Type a question' } });
    expect(screen.getByRole('button', { name: 'Hold to ask' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Type a question' }));
    expect(textBox().placeholder).toBe('Type a question');
  });

  it('shows the text box with a disabled mic when the browser cannot turn speech into text', () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    open();
    expect(textBox()).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Speak a message' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('attach and camera', () => {
  it('are hidden when the app passes none', () => {
    open();
    expect(screen.queryByRole('button', { name: 'Attach files' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Take a photo' })).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Type a message' }));
    expect(screen.queryByRole('button', { name: 'Attach files' })).toBeNull();
  });

  it('are small and secondary when it does, in both layouts', () => {
    open({ attach: true, camera: true });
    for (const name of ['Attach files', 'Take a photo']) {
      const button = screen.getByRole('button', { name });
      expect(button.className).toContain('bk-composer__quiet');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Type a message' }));
    expect(screen.getByRole('button', { name: 'Attach files' }).className).toContain('bk-composer__quiet');
    expect(screen.getByRole('button', { name: 'Take a photo' }).className).toContain('bk-composer__quiet');
  });

  it('shows a picked file as a thumbnail with a remove x, and sends it with the words', async () => {
    open({ attach: true });
    const picker = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(picker, { target: { files: [new File([new Uint8Array([137, 80, 78, 71])], 'photo.png', { type: 'image/png' })] } });
    });
    await pass();
    const thumb = screen.getByRole('img', { name: 'photo.png' }) as HTMLImageElement;
    expect(thumb.src).toBe('blob:preview');
    expect(thumb.className).toContain('bk-composer__thumb');
    expect(screen.getByRole('button', { name: 'Remove photo.png' })).toBeTruthy();
    await press();
    await hear('this screen is wrong');
    await letGo();
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe('this screen is wrong');
    expect(sent[0].files).toEqual([{ name: 'photo.png', type: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) }]);
  });

  describe('a picture attached and nothing typed: a Send arrow beside the bar (mw-jtzpw0.9)', () => {
    async function attachPicture(props: Partial<ComposerProps> = {}) {
      open({ attach: true, camera: true, ...props });
      const picker = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(picker, { target: { files: [new File([new Uint8Array([137, 80, 78, 71])], 'photo.png', { type: 'image/png' })] } });
      });
      await pass();
    }

    it('shows a Send button beside Hold to talk, and one tap sends the picture with empty text', async () => {
      await attachPicture();
      const send = screen.getByRole('button', { name: 'Send' });
      expect(send.className).toContain('bk-composer__bar-send');
      expect((send as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(send);
      await pass();
      expect(sent).toEqual([{ text: '', files: [{ name: 'photo.png', type: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]) }] }]);
      // it went: the box is empty, the arrow is gone and the bar stands alone again
      expect(screen.queryByRole('img', { name: 'photo.png' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Hold to talk' })).toBeTruthy();
    });

    it('shows no Send button with nothing attached, and none once the picture is removed', async () => {
      open({ attach: true });
      expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
      cleanup();
      await attachPicture();
      expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Remove photo.png' }));
      expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    });

    it('keeps Hold to talk the same button in the same place: the same element, first in its row, the arrow after it', async () => {
      open({ attach: true });
      const before = screen.getByRole('button', { name: 'Hold to talk' });
      const row = before.parentElement as HTMLElement;
      expect(row.className).toContain('bk-composer__bar-row');
      const picker = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
      await act(async () => {
        fireEvent.change(picker, { target: { files: [new File([new Uint8Array([1])], 'photo.png', { type: 'image/png' })] } });
      });
      await pass();
      const after = screen.getByRole('button', { name: 'Hold to talk' });
      expect(after).toBe(before);
      expect(after.parentElement).toBe(row);
      expect(after.className).toBe('bk-composer__bar');
      expect(row.firstElementChild).toBe(after);
      expect(after.compareDocumentPosition(screen.getByRole('button', { name: 'Send' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('holds the arrow back while the bar is held', async () => {
      await attachPicture();
      await press();
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.pointerUp(bar(), ON);
      await pass();
      await pass();
    });

    it('keeps the existing Send in the text box when words are typed', async () => {
      await attachPicture();
      fireEvent.click(screen.getByRole('button', { name: 'Type a message' }));
      expect(screen.getAllByRole('button', { name: 'Send' })).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Send' }).className).toContain('bk-composer__send');
      fireEvent.change(textBox(), { target: { value: 'look' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await pass();
      expect(sent[0].text).toBe('look');
      expect(sent[0].files).toHaveLength(1);
    });

    it('keeps the picture and the arrow when the app says it did not go', async () => {
      onSend.mockImplementationOnce(async () => false);
      await attachPicture();
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await pass();
      expect(screen.getByRole('img', { name: 'photo.png' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Hold to talk' })).toBeTruthy();
    });
  });

  it('takes a picked file away with its remove x', async () => {
    open({ attach: true, camera: true });
    const camera = document.querySelector('input[type="file"][capture]') as HTMLInputElement;
    expect(camera.accept).toBe('image/*');
    await act(async () => {
      fireEvent.change(camera, { target: { files: [new File([new Uint8Array([1])], 'snap.jpg', { type: 'image/jpeg' })] } });
    });
    await pass();
    fireEvent.click(screen.getByRole('button', { name: 'Remove snap.jpg' }));
    expect(screen.queryByRole('img', { name: 'snap.jpg' })).toBeNull();
  });

  it('refuses a file the app refuses, and says why', async () => {
    open({ attach: true, refuseFile: (file) => (file.size > 2 ? `${file.name} is too big.` : undefined) });
    const picker = document.querySelector('input[type="file"][multiple]') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(picker, { target: { files: [new File([new Uint8Array([1, 2, 3])], 'big.bin', { type: 'application/octet-stream' })] } });
    });
    await pass();
    expect(screen.queryByRole('button', { name: 'Remove big.bin' })).toBeNull();
    expect(screen.getByText('big.bin is too big.')).toBeTruthy();
  });
});

describe('a language-not-supported on Android Chrome (mw-hgtlf5.1)', () => {
  const ERROR = /language-not-supported/;

  it('his screen: a touch on the bar let go before the on-device check answers shows no red language-not-supported line', async () => {
    FakeRecognizer.onDevice = 'unavailable';
    open();
    fireEvent.pointerDown(bar());
    giveTheBarAShape();
    fireEvent.pointerUp(bar(), ON);
    await pass();
    await pass();
    await pass(STOP_TIMEOUT_MS);
    expect(screen.queryByText(ERROR)).toBeNull();
    expect(sent).toEqual([]);
    expect(FakeRecognizer.instances).toHaveLength(1);
  });

  it('a hold on Android goes on in the cloud, and so does the next one: his words are heard and sent both times', async () => {
    FakeRecognizer.onDevice = 'unavailable';
    open();
    for (const words of ['the first time', 'the second time']) {
      await press();
      expect(screen.queryByText(ERROR)).toBeNull();
      expect(FakeRecognizer.instances.at(-1)?.processLocally).toBe(false);
      await hear(words);
      await letGo();
    }
    expect(sent).toEqual([
      { text: 'the first time', files: [] },
      { text: 'the second time', files: [] },
    ]);
    expect(FakeRecognizer.instances).toHaveLength(4);
  });

  it('every route failing says what was tried under the bar, and the bar says Try again: a hold on it is a fresh one', async () => {
    open();
    await press();
    for (let route = 0; route < 3; route++) await act(async () => FakeRecognizer.instances[route]?.onerror?.({ error: 'language-not-supported' }));
    expect(screen.getByText(/\(tried: on-device en-US, cloud en-US, cloud default\)$/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(sent).toEqual([]);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Try again' }));
    await pass();
    giveTheBarAShape();
    expect(screen.queryByText(ERROR)).toBeNull();
    expect(FakeRecognizer.instances).toHaveLength(4);
    expect(FakeRecognizer.instances[3].processLocally).toBe(true);
    await hear('second time lucky');
    await letGo();
    expect(sent).toEqual([{ text: 'second time lucky', files: [] }]);
    expect(screen.getByRole('button', { name: 'Hold to talk' })).toBeTruthy();
  });
});
