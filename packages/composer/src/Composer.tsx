// Composer.tsx (lifted from Postern's src/cockpit/Composer.tsx) — how he says something to the app: words he speaks
// or types, and, when the app allows them, files from the picker, a photo from the camera, a paste or a drop. All the
// files go as one message, the words its caption, through the app's onSend.
// With something attached and nothing typed, a Send arrow stands beside the bar and one tap sends the files with
// no words (mw-jtzpw0.9); the bar stays the big button and does not move.
// The hold-to-talk bar: hold it and the words stream on screen, let go and the words, the voice note (when the
// app asks for one) and whatever is attached go as one message; slide off the bar first and nothing goes.
// Whatever ends a hold without sending it (a slide off, the phone taking the touch, the app hidden, the recogniser
// failing, a release it settles with no words) leaves the words heard so far in the box, unsent, saying
// 'Kept what you said: tap Send.' (mw-f7gmps.3). A hold that ends with a notice and no words (the recogniser failed by
// every route, nothing was heard) shows the notice above the bar, and the bar says 'Try again': a hold on it is a fresh
// one, every route untried (mw-hgtlf5.1).
// mode 'speak' is Postern's layout: the big bar first, attach, camera and 'Type a message' quiet below it, and the
// text box once he chooses to type or a hold leaves words in it. mode 'type' puts the text box and Send first with a
// small mic that brings the bar out. The app passes what is its own: how audio becomes text (a Transcriber), what
// Send does, whether attach and camera show, and the words on the screen. The look is the app's too: class names
// (bk-composer__*) and CSS custom properties (--bk-composer-*), with defaults in styles.css.
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { HoldToTalkBar } from './HoldToTalkBar.js';
import { Icon } from './icons.js';
import { formatDuration, type Recording } from './recorder.js';
import type { Transcriber } from './transcriber.js';
import { micName, useHold } from './useHold.js';

/** A file as the app gets it in a message. A voice note recorded by a hold carries its length. */
export interface OutgoingFile {
  name: string;
  type: string;
  bytes: Uint8Array;
  durationMs?: number;
}

/** What Send hands the app: the words (trimmed; empty when only files go) and the files, in the order they were added. */
export interface ComposerMessage {
  text: string;
  files: OutgoingFile[];
}

export type ComposerMode = 'speak' | 'type';

/** Every word the composer puts on the screen; the app replaces any of them ('Hold to ask', 'Type a question'). */
export interface ComposerLabels {
  /** The bar, before a hold. */
  hold: string;
  /** The bar, after a hold that ended with a notice (the recogniser failed, nothing was heard): a hold on it is a fresh one. */
  tryAgain: string;
  /** The bar, while he holds and the mic is open. */
  release: string;
  /** The bar and the live words, while the mic opens. */
  starting: string;
  /** The bar, while his finger is off it. */
  drop: string;
  /** The live words, before any are heard. */
  listening: string;
  /** Under the bar, before a hold. */
  hint: string;
  /** The quiet button below the bar that brings the text box out. */
  typeInstead: string;
  /** The text box's placeholder. */
  placeholder: string;
  /** The text box's accessible name. */
  message: string;
  send: string;
  /** The mic button beside the text box, which brings the bar out. */
  speak: string;
  attach: string;
  camera: string;
  /** Said when a hold ended without sending and its words wait in the box. */
  kept: string;
  /** The accessible name of the row of files waiting to go. */
  toSend: string;
  /** A voice note waiting to go. */
  voiceNote: string;
  /** The remove x on a file waiting to go. */
  remove: (name: string) => string;
  /** Which microphone the hold listens on: a Bluetooth input's label, or nothing for the default. */
  micName: (input: string | undefined) => string;
  /** Said when a voice note was refused and the words went without it. */
  voiceNoteRefused: (refusal: string) => string;
}

export const DEFAULT_LABELS: ComposerLabels = {
  hold: 'Hold to talk',
  tryAgain: 'Try again',
  release: 'Release to send',
  starting: 'Starting the mic…',
  drop: 'Let go to keep it unsent',
  listening: 'Listening…',
  hint: 'Hold the bar and speak. Slide off it to keep the words unsent.',
  typeInstead: 'Type a message',
  placeholder: 'Type a message',
  message: 'Message',
  send: 'Send',
  speak: 'Speak a message',
  attach: 'Attach files',
  camera: 'Take a photo',
  kept: 'Kept what you said: tap Send.',
  toSend: 'To send',
  voiceNote: 'Voice note',
  remove: (name) => `Remove ${name}`,
  micName,
  voiceNoteRefused: (refusal) => `${refusal} The words went without the voice note.`,
};

export interface ComposerProps {
  /**
   * Sends the message. Resolve (or return) false, or throw, when it did not go: the words wait in the box, nothing
   * he said is lost. A thrown Error's message is shown.
   */
  onSend: (message: ComposerMessage) => Promise<boolean | void> | boolean | void;
  /** 'speak' (the default): the hold bar first. 'type': the text box and Send first, with a small mic. */
  mode?: ComposerMode;
  /** How audio becomes text: the browser's speech recogniser (browserSpeech) unless given, or transcribeRecording(fn). */
  transcriber?: Transcriber;
  /** The language to listen for; the page's `<html lang>` when not given. */
  lang?: string;
  /** The app's name, in the messages that say how to allow the microphone ('this app' when not given). */
  appName?: string;
  /** Show the attach button (any file from the picker); paste and drop add files too. Hidden when not given. */
  attach?: boolean;
  /** Show the camera button (a photo, on a phone). Hidden when not given. */
  camera?: boolean;
  /** Record the voice of each hold and send it with the words as a voice note. */
  recordVoice?: boolean;
  /** Words to put on the screen in place of the defaults (DEFAULT_LABELS). */
  labels?: Partial<ComposerLabels>;
  /** Says why a file cannot go (too big, say), or nothing when it can. A refused file is not added. */
  refuseFile?: (file: { name: string; type: string; size: number }) => string | undefined;
  /** Gets what the composer would say about a refused file or a failed send, in place of showing it in its own line. */
  onNotice?: (message: string) => void;
  /** Words already in the box when it opens; the caret waits after them. */
  initialText?: string;
  autoFocus?: boolean;
  /** Nothing can be held or sent (the app is not ready). */
  disabled?: boolean;
  /** Shown at the top of the composer (a quoted message, say). */
  top?: ReactNode;
  className?: string;
}

interface Pending extends OutgoingFile {
  id: string;
  preview?: string;
}

let nextId = 1;

async function toPending(file: File | Blob, name: string, durationMs?: number): Promise<Pending> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = file.type || 'application/octet-stream';
  return {
    id: String(nextId++),
    name,
    type,
    bytes,
    ...(durationMs !== undefined && { durationMs }),
    preview: type.startsWith('image/') || type.startsWith('audio/') ? URL.createObjectURL(file) : undefined,
  };
}

const outgoing = (files: readonly Pending[]): OutgoingFile[] =>
  files.map(({ name, type, bytes, durationMs }) => ({ name, type, bytes, ...(durationMs !== undefined && { durationMs }) }));

const forget = (files: readonly Pending[]) => files.forEach((file) => file.preview && URL.revokeObjectURL(file.preview));

/** Focuses the box and leaves the scroll position alone: a focus that scrolls can push a phone's page up under its status bar. */
function focusQuietly(area: HTMLTextAreaElement | null): void {
  if (!area) return;
  area.focus({ preventScroll: true });
  area.setSelectionRange(area.value.length, area.value.length);
}

export function Composer({
  onSend,
  mode = 'speak',
  transcriber,
  lang,
  appName,
  attach = false,
  camera = false,
  recordVoice = false,
  labels: given,
  refuseFile,
  onNotice,
  initialText = '',
  autoFocus = false,
  disabled = false,
  top,
  className,
}: ComposerProps) {
  const labels: ComposerLabels = { ...DEFAULT_LABELS, ...given };
  const [text, setText] = useState(initialText);
  const [files, setFiles] = useState<Pending[]>([]);
  // The hold-to-talk bar is out in place of the text box: 'speak' opens with it, the mic brings it out.
  const [voice, setVoice] = useState(mode === 'speak');
  const [holding, setHolding] = useState(false);
  // A hold ended without sending and its words wait in the box (until they are sent).
  const [kept, setKept] = useState(false);
  const [busy, setBusy] = useState(false);
  // What the composer says about a refused file or a failed send, when the app does not take it (onNotice).
  const [notice, setNotice] = useState<string | undefined>();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const shutter = useRef<HTMLInputElement>(null);
  const hold = useHold({
    transcriber,
    lang,
    appName,
    record: recordVoice,
    onFailed: (said) => {
      setHolding(false);
      keep(said);
    },
    onHidden: (said) => {
      setHolding(false);
      keep(said);
    },
  });

  // Only when it opens: what he types after is his.
  useEffect(() => {
    if (autoFocus || initialText) focusQuietly(textarea.current);
  }, []);

  // The app switched between speak-first and type-first: the composer takes the new layout.
  const shownMode = useRef(mode);
  useEffect(() => {
    if (shownMode.current === mode) return;
    shownMode.current = mode;
    setVoice(mode === 'speak');
  }, [mode]);

  useEffect(() => {
    const area = textarea.current;
    if (!area) return;
    // grows with the words; the stylesheet's max-height caps it
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
  }, [text]);

  function say(message: string) {
    if (onNotice) onNotice(message);
    else setNotice(message);
  }

  async function addFiles(list: FileList | File[]) {
    const accepted: Pending[] = [];
    for (const file of Array.from(list)) {
      const refusal = refuseFile?.(file);
      if (refusal) {
        say(refusal);
        continue;
      }
      accepted.push(await toPending(file, file.name));
    }
    setFiles((current) => [...current, ...accepted]);
  }

  /** The voice note a hold recorded, as a file for the message. */
  function voiceFile(recording: Recording): Promise<Pending | undefined> {
    const refusal = refuseFile?.({ name: labels.voiceNote, type: recording.mime, size: recording.blob.size });
    if (refusal) {
      say(labels.voiceNoteRefused(refusal));
      return Promise.resolve(undefined);
    }
    return toPending(recording.blob, `voice-${new Date().toISOString()}.${recording.mime.split('/')[1]}`, recording.durationMs);
  }

  /** Hands the message to the app; true when it went. */
  async function deliver(words: string, attached: Pending[]): Promise<boolean> {
    setBusy(true);
    try {
      return (await onSend({ text: words, files: outgoing(attached) })) !== false;
    } catch (err) {
      say(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  /** It went: the box empties, and 'speak' goes back to the bar. */
  function sent(went: Pending[]) {
    forget(went);
    setFiles([]);
    setText('');
    setKept(false);
    setNotice(undefined);
    setVoice(mode === 'speak');
  }

  function press() {
    if (holding) return;
    setHolding(hold.begin());
  }

  /** The words of a hold that ended without sending go in the box, unsent; the box shows in place of the bar. */
  function keep(said: string, voiceNote?: Pending) {
    if (voiceNote) setFiles((current) => [...current, voiceNote]);
    if (!said) return;
    setText((current) => (current.trim() ? `${current.trim()} ${said}` : said));
    setVoice(false);
    setKept(true);
  }

  async function release() {
    setHolding(false);
    const released = await hold.finish();
    if (released.status === 'kept') {
      keep(released.text, released.recording ? await voiceFile(released.recording) : undefined);
      return;
    }
    if (released.status !== 'heard') return;
    // words that could not be made out are the app's to show too, when it takes the composer's notices
    if (released.missed && onNotice) onNotice(released.missed);
    const words = released.text.trim();
    const voiceNote = released.recording ? await voiceFile(released.recording) : undefined;
    const going = voiceNote ? [...files, voiceNote] : files;
    if (await deliver(words, going)) sent(going);
    else {
      // it did not go: the words and the voice note wait in the box, nothing he said is lost
      setText(words);
      if (voiceNote) setFiles((current) => [...current, voiceNote]);
      setVoice(false);
    }
  }

  // Android Chrome raises the keyboard only for a focus inside the tap itself: draw the box now, then focus it.
  function typeInstead() {
    flushSync(() => setVoice(false));
    focusQuietly(textarea.current);
  }

  function drop() {
    setHolding(false);
    keep(hold.drop() ?? '');
  }

  async function send() {
    if (busy || disabled) return;
    const words = text.trim();
    if (!words && files.length === 0) return;
    if (await deliver(words, files)) sent(files);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends where there is a keyboard (a fine pointer), or with Ctrl or Cmd; Shift+Enter is a new line
    if (event.key === 'Enter' && !event.shiftKey && (event.metaKey || event.ctrlKey || window.matchMedia?.('(pointer: fine)').matches)) {
      event.preventDefault();
      void send();
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = Array.from(event.clipboardData.files);
    if (attach && pasted.length) {
      event.preventDefault();
      void addFiles(pasted);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    if (attach && event.dataTransfer.files.length) {
      event.preventDefault();
      void addFiles(event.dataTransfer.files);
    }
  }

  function remove(file: Pending) {
    forget([file]);
    setFiles((current) => current.filter((f) => f.id !== file.id));
  }

  const canSend = text.trim().length > 0 || files.length > 0;
  // The bar takes the text box's place while there are no words in it.
  const barOut = voice && text.trim().length === 0 && hold.supported;
  // Pictures or files alone leave the mic beside Send; a voice note recorded (one per message), or words, take it away.
  const showMic = text.trim().length === 0 && !files.some((file) => file.durationMs !== undefined);
  // 'type' always shows Send; 'speak' shows it once there is something to send, the mic standing in for it before.
  const showSend = mode === 'type' || canSend;

  const quiet = (
    <>
      {attach && (
        <button type="button" aria-label={labels.attach} className="bk-composer__button bk-composer__quiet" disabled={disabled} onClick={() => picker.current?.click()}>
          <Icon name="attach" />
        </button>
      )}
      {camera && (
        <button type="button" aria-label={labels.camera} className="bk-composer__button bk-composer__quiet bk-composer__camera" disabled={disabled} onClick={() => shutter.current?.click()}>
          <Icon name="camera" />
        </button>
      )}
    </>
  );

  return (
    <div
      className={className ? `bk-composer ${className}` : 'bk-composer'}
      data-mode={mode}
      data-layout={barOut ? 'bar' : 'field'}
      onDragOver={(event) => attach && event.preventDefault()}
      onDrop={onDrop}
      data-testid="composer"
    >
      {top}
      {files.length > 0 && (
        <div className="bk-composer__files" role="group" aria-label={labels.toSend}>
          {files.map((file) => (
            <div key={file.id} className="bk-composer__file">
              {file.type.startsWith('image/') && file.preview ? (
                <img src={file.preview} alt={file.name} className="bk-composer__thumb" />
              ) : file.type.startsWith('audio/') ? (
                <span className="bk-composer__file-label bk-composer__file-label--voice">
                  <Icon name="mic" size={16} />
                  {labels.voiceNote} {file.durationMs !== undefined ? formatDuration(file.durationMs) : ''}
                </span>
              ) : (
                <span className="bk-composer__file-label">
                  <Icon name="file" size={16} />
                  <span className="bk-composer__file-name">{file.name}</span>
                </span>
              )}
              <button type="button" aria-label={labels.remove(file.name)} className="bk-composer__remove" onClick={() => remove(file)}>
                <Icon name="x" size={11} strokeWidth={2.4} />
              </button>
            </div>
          ))}
        </div>
      )}
      {barOut ? (
        <div className="bk-composer__speak">
          <div role="status" aria-live="polite" className="bk-composer__status">
            {holding ? (
              <>
                <p data-testid="live-transcript" className="bk-composer__live">
                  {hold.mic === 'ready' ? hold.transcript || labels.listening : labels.starting}
                </p>
                {hold.mic === 'ready' && (
                  <p data-testid="mic-name" className="bk-composer__mic-name">
                    {labels.micName(hold.input)}
                  </p>
                )}
              </>
            ) : (
              <p className={hold.notice ? 'bk-composer__hint bk-composer__error' : 'bk-composer__hint'}>{hold.notice ?? labels.hint}</p>
            )}
          </div>
          <div className="bk-composer__bar-row">
            <HoldToTalkBar
              label={holding ? (hold.mic === 'ready' ? labels.release : labels.starting) : hold.notice ? labels.tryAgain : labels.hold}
              dropLabel={labels.drop}
              listening={holding}
              disabled={busy || disabled}
              onPress={press}
              onRelease={() => void release()}
              onAbort={drop}
              dropOnSlideOff
            />
            {files.length > 0 && (
              <button type="button" aria-label={labels.send} className="bk-composer__button bk-composer__bar-send" disabled={busy || disabled || holding} onClick={() => void send()}>
                <Icon name="send" />
              </button>
            )}
          </div>
          <div className="bk-composer__quiet-row">
            {quiet}
            <button type="button" className="bk-composer__type-instead" disabled={holding} onClick={typeInstead}>
              {labels.typeInstead}
            </button>
          </div>
        </div>
      ) : (
        <div className="bk-composer__field-row">
          {mode === 'speak' && quiet}
          <textarea
            ref={textarea}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            aria-label={labels.message}
            placeholder={labels.placeholder}
            className="bk-composer__field"
          />
          {showMic && (
            <button type="button" aria-label={labels.speak} className="bk-composer__button bk-composer__mic" disabled={!hold.supported || disabled} onClick={() => setVoice(true)}>
              <Icon name="mic" />
            </button>
          )}
          {showSend && (
            <button type="button" aria-label={labels.send} className="bk-composer__button bk-composer__send" disabled={busy || disabled || !canSend} onClick={() => void send()}>
              <Icon name="send" />
            </button>
          )}
        </div>
      )}
      {!barOut && mode === 'type' && (attach || camera) && <div className="bk-composer__quiet-row">{quiet}</div>}
      {kept && text.trim().length > 0 && (
        <p role="status" className="bk-composer__kept">
          {hold.notice && <span className="bk-composer__error">{hold.notice} </span>}
          <span>{labels.kept}</span>
        </p>
      )}
      {notice && (
        <p role="alert" className="bk-composer__notice bk-composer__error">
          {notice}
        </p>
      )}
      {attach && (
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files);
            event.target.value = '';
          }}
        />
      )}
      {camera && (
        <input
          ref={shutter}
          type="file"
          hidden
          accept="image/*"
          capture="environment"
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files);
            event.target.value = '';
          }}
        />
      )}
    </div>
  );
}
