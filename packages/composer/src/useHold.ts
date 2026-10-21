// useHold.ts (lifted from Postern's src/cockpit/useHold.ts) — one hold of the hold-to-talk bar: the phone listens
// while the bar is held (through the app's Transcriber, the browser's recogniser by default: listen.ts), the words
// so far stream into `transcript`, and letting go hands back what was said.
// In Postern the Talk line and the composer both hold through this, so a hold is one
// thing in the app. With `record` the same hold also records the voice (recorder.ts), so a
// release hands back the audio beside the words. The recorder takes the recogniser's microphone and
// never opens another (mw-f7gmps.1): on Android a second capture moves the phone onto the Bluetooth
// route the recogniser hears nothing on. On a chosen input it records a copy of the input's track;
// when the hold leaves that input for the default microphone the recording goes with it. On a phone's
// default microphone it does not record at all, so the hold opens what the Talk line's does: there the
// recogniser opens the microphone itself (Android's speech service, outside the page), and a capture the
// page holds beside it takes the microphone, so the recogniser hears silence and the hold ends with
// 'No speech was heard.' (mw-f7gmps.2). Only a browser that cannot list its inputs records the default microphone.
// Whatever ends a hold, the words that were on the screen are handed back, never thrown away (mw-f7gmps.3):
// a drop, a recogniser that fails or a page that is hidden while he holds gives them to the caller, and a
// release the recogniser settles with no words gives back the words it showed as 'kept', not as heard.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ListenMode, ListenSession } from './listen.js';
import { canChooseInput, openBluetoothInput } from './micInput.js';
import { canRecord, VoiceRecorder, type Recording } from './recorder.js';
import { browserSpeech, type Transcriber } from './transcriber.js';

function buzz(ms: number): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(ms);
}

/** What the notice says of a stretch that could not be made out, when the listener gave no reason. */
const MISSED_NOTICE = 'Some of the words could not be made out.';

/** Which microphone the hold is on, for the screen: the Bluetooth input chosen (his car's, say), or the phone's default. */
export function micName(input: string | undefined): string {
  return input ? `Listening on the Bluetooth microphone: ${input}.` : "Listening on the phone's own microphone.";
}

/**
 * What a release came to: nothing was held, a hold heard no words, or the words (and the voice, when it could be
 * recorded). 'kept': the recogniser settled with no words, but words were on the screen while he held; they are
 * the words heard so far, to keep rather than to send as if settled.
 */
export type Released =
  | { status: 'idle' }
  | { status: 'empty' }
  | { status: 'heard'; text: string; recording?: Recording; missed?: string }
  | { status: 'kept'; text: string; recording?: Recording };

interface HeldRecording {
  recorder: VoiceRecorder;
  started: Promise<boolean>;
}

export interface HoldOptions {
  /** How audio becomes text: the browser's speech recogniser unless the app passes another (transcriber.ts). */
  transcriber?: Transcriber;
  /** The language to listen for; the page's own (`<html lang>`) when not given. */
  lang?: string;
  /** The app's name, for the messages that say how to allow the microphone. */
  appName?: string;
  /** Record the voice along with the words. A recording that cannot be made leaves the words alone. */
  record?: boolean;
  /** The recogniser failed while he is still holding: the hold is over (the notice says why). `said` is the words heard so far. */
  onFailed?: (said: string) => void;
  /** Given, a page hidden while he holds (he left the app) ends the hold, and this gets the words heard so far. */
  onHidden?: (said: string) => void;
  /**
   * Given, a recogniser that settles by itself while he holds (it ended and could not be started again) ends the hold there and
   * then, and this gets what the release would have (mw-06ggew.14). Not given, the hold goes on to his release as before.
   */
  onEnded?: (released: Released) => void;
}

export function useHold({ transcriber = browserSpeech, lang, appName, record = false, onFailed, onHidden, onEnded }: HoldOptions = {}) {
  const [transcript, setTranscript] = useState('');
  const [notice, setNotice] = useState<string | undefined>();
  const [mode, setMode] = useState<ListenMode | undefined>();
  // 'starting' until the recogniser says the mic is open; 'fellBack' once on-device failed and the hold went on in cloud mode.
  const [mic, setMic] = useState<'starting' | 'ready'>('starting');
  const [fellBack, setFellBack] = useState(false);
  // The label of the Bluetooth input the hold listens on; nothing means the phone's default microphone.
  const [input, setInput] = useState<string | undefined>();
  const listening = useRef<ListenSession | null>(null);
  const recording = useRef<HeldRecording | null>(null);
  // Names the hold the recogniser's callbacks belong to; cleared when the hold ends, so a late event is ignored.
  const hold = useRef<object | null>(null);
  // The words on the screen in this hold: a blank update from the recogniser never takes them back.
  const said = useRef('');
  const failed = useRef(onFailed);
  const hidden = useRef(onHidden);
  const ended = useRef(onEnded);
  useEffect(() => {
    failed.current = onFailed;
    hidden.current = onHidden;
    ended.current = onEnded;
  }, [onFailed, onHidden, onEnded]);
  // begin's onEnd calls finish, which is made below
  const finishing = useRef<() => Promise<Released>>(() => Promise.resolve({ status: 'idle' }));

  const dropRecording = useCallback(() => {
    const taken = recording.current;
    recording.current = null;
    // the recorder may still be opening the microphone: it is cancelled once it is open
    if (taken) void taken.started.then(() => taken.recorder.cancel());
  }, []);

  useEffect(
    () => () => {
      hold.current = null;
      listening.current?.abort();
      dropRecording();
    },
    [dropRecording],
  );

  /** Starts listening. False when the hold could not start (the notice says why). */
  const begin = useCallback((): boolean => {
    setNotice(undefined);
    buzz(30);
    const thisHold = {};
    hold.current = thisHold;
    said.current = '';
    const recordHold = record && canRecord();
    const startRecording = (track?: MediaStreamTrack) => {
      const recorder = new VoiceRecorder();
      recording.current = {
        recorder,
        started: recorder.start(track).then(
          () => true,
          () => false,
        ),
      };
    };
    const choosing = canChooseInput();
    const started = transcriber.start({
      lang: lang ?? (typeof document === 'undefined' ? undefined : document.documentElement.lang),
      appName,
      onInterim: (text) => {
        if (hold.current !== thisHold || !text.trim()) return;
        said.current = text;
        setTranscript(text);
      },
      onStart: () => {
        if (hold.current !== thisHold) return;
        setMic('ready');
        // the route the mic opened on is the mode on the screen (a hold can go from on-device to the cloud and on, mw-hgtlf5.1)
        const session = listening.current;
        if (session) setMode(session.mode);
      },
      openInput: choosing
        ? async () => {
            const opened = await openBluetoothInput();
            // a copy of the chosen input's track, never a microphone of its own beside the recogniser's
            if (recordHold && opened && hold.current === thisHold) startRecording(opened.track);
            return opened;
          }
        : undefined,
      onInput: (label) => {
        if (hold.current !== thisHold) return;
        setInput(label);
        // the hold left the chosen input: its recording goes with it, and no other microphone is opened
        if (label === undefined) dropRecording();
      },
      onFallback: () => {
        if (hold.current !== thisHold) return;
        setMode('cloud');
        setFellBack(true);
        setMic('starting');
      },
      onError: (error) => {
        if (hold.current !== thisHold) return;
        hold.current = null;
        listening.current?.abort();
        listening.current = null;
        dropRecording();
        setNotice(error.message);
        failed.current?.(said.current.trim());
      },
      onEnd: () => {
        if (hold.current !== thisHold || !ended.current) return;
        void finishing.current().then((released) => ended.current?.(released));
      },
    });
    if (!started.ok) {
      hold.current = null;
      setNotice(started.error.message);
      return false;
    }
    listening.current = started.session;
    setMode(started.session.mode);
    setMic('starting');
    setFellBack(false);
    setInput(undefined);
    setTranscript('');
    if (recordHold && !choosing) startRecording();
    return true;
  }, [transcriber, lang, appName, record, dropRecording]);

  /** Lets go: waits for the recogniser's last words and hands back what was said. */
  const finish = useCallback(async (): Promise<Released> => {
    const session = listening.current;
    if (!session) return { status: 'idle' };
    listening.current = null;
    hold.current = null;
    buzz(15);
    const held = recording.current;
    recording.current = null;
    const voice = held ? stopRecording(held) : Promise.resolve(undefined);
    const result = await session.stop();
    if (result.text.trim()) {
      // a stretch that could not be made out: the words that were go, and the notice says what was missed (mw-q6n8m0.5, mw-06ggew.1)
      const missed = result.ok && result.missed ? (result.missedNote ?? MISSED_NOTICE) : undefined;
      if (missed) setNotice(missed);
      return { status: 'heard', text: result.text, recording: await voice, ...(missed ? { missed } : {}) };
    }
    // the recogniser settled with no words (a blank final), but the words it showed are his
    if (said.current.trim()) return { status: 'kept', text: said.current.trim(), recording: await voice };
    setNotice(result.ok ? 'No speech was heard.' : result.error.message);
    return { status: 'empty' };
  }, []);
  finishing.current = finish;

  /** Ends the hold without sending: undefined when there was no hold, else the words heard so far (blank when none). */
  const drop = useCallback((): string | undefined => {
    hold.current = null;
    dropRecording();
    if (!listening.current) return undefined;
    listening.current.abort();
    listening.current = null;
    return said.current.trim();
  }, [dropRecording]);

  // He left the app while holding: Android suspends the page, so the hold ends here and his words are handed back.
  useEffect(() => {
    const onChange = () => {
      if (document.visibilityState !== 'hidden' || !hidden.current) return;
      const words = drop();
      if (words !== undefined) hidden.current(words);
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [drop]);

  return {
    transcript,
    notice,
    setNotice,
    mode,
    mic,
    fellBack,
    input,
    supported: transcriber.supported(),
    begin,
    finish,
    drop,
  };
}

/** How a hold ended: he let go, the recogniser failed, it was cancelled (a slide off, the phone taking the touch, the app's own), the recogniser ended by itself and could not go on, or the page was hidden. */
export type HoldEnding = 'release' | 'error' | 'cancel' | 'ended' | 'hidden';

/** How a hold ended: letting go (or stopping a latched listen) is `cancelled: false`; every other end is `cancelled: true`. */
export interface HoldEnd {
  cancelled: boolean;
  ended: HoldEnding;
}

/**
 * The words of a hold, however it ended. 'heard': he let go and the recogniser settled them: words to send. 'kept': any other end
 * (and a release the recogniser settled blank): the words heard so far, his, to keep unsent for him to send (the Composer puts them in its box).
 */
export type HoldWords = (Extract<Released, { status: 'heard' }> | Extract<Released, { status: 'kept' }>) & { ended: HoldEnding };

export interface BarHoldOptions extends Omit<HoldOptions, 'onFailed' | 'onHidden' | 'onEnded'> {
  /** Every hold's words, once, however it ended; not called for a hold that heard nothing. */
  onWords: (text: string, words: HoldWords) => void;
  /** A hold begins, before the microphone opens: pause what is playing aloud. Always followed by onHoldEnd. */
  onHoldStart?: () => void;
  /** The hold is over: after the last words are in (just before onWords), or at once on any other end. Give back what onHoldStart took. */
  onHoldEnd?: (end: HoldEnd) => void;
}

/**
 * THE hold of a hold-to-talk bar (mw-06ggew.14): the one place that starts a hold (press), lets it go (release), cancels it, and
 * ends it when the recogniser fails, ends by itself or the page is hidden (useHold does the listening, listen.ts the restarts
 * while held). The Composer and useTalk both hold through it, so a hold behaves as Postern's does in every app: whatever ends
 * it, the words heard so far are handed to onWords, between onHoldStart and onHoldEnd.
 */
export function useBarHold({ onWords, onHoldStart, onHoldEnd, ...options }: BarHoldOptions) {
  const [holding, setHolding] = useState(false);
  // How many holds onHoldStart began and onHoldEnd has not yet closed: more than one when he presses again while the last words of the last hold are awaited.
  const open = useRef(0);
  const callbacks = useRef({ onWords, onHoldStart, onHoldEnd });
  callbacks.current = { onWords, onHoldStart, onHoldEnd };

  const close = useCallback((cancelled: boolean, ended: HoldEnding) => {
    if (open.current === 0) return;
    open.current -= 1;
    callbacks.current.onHoldEnd?.({ cancelled, ended });
  }, []);

  /** The hold is over (not by a release): it closes, and the words heard so far are handed on, kept. */
  const over = useCallback(
    (ended: HoldEnding, said: string | undefined, recording?: Recording) => {
      setHolding(false);
      close(true, ended);
      const text = said?.trim();
      if (text) callbacks.current.onWords(text, { status: 'kept', text, recording, ended });
    },
    [close],
  );

  const hold = useHold({
    ...options,
    onFailed: (said) => over('error', said),
    onHidden: (said) => over('hidden', said),
    onEnded: (released) => (released.status === 'heard' || released.status === 'kept' ? over('ended', released.text, released.recording) : over('ended', undefined)),
  });
  const { begin, finish, drop } = hold;

  /** A hold begins. False when it could not start (the notice says why); it is then over at once. */
  const press = useCallback((): boolean => {
    if (holding) return false;
    open.current += 1;
    callbacks.current.onHoldStart?.();
    const started = begin();
    setHolding(started);
    if (!started) close(true, 'error');
    return started;
  }, [holding, begin, close]);

  /** He lets go: the recogniser's last words are awaited, then handed on. */
  const release = useCallback(async (): Promise<Released> => {
    setHolding(false);
    const released = await finish();
    if (released.status === 'idle') return released;
    close(false, 'release');
    if (released.status === 'heard' || released.status === 'kept') callbacks.current.onWords(released.text.trim(), { ...released, ended: 'release' });
    return released;
  }, [finish, close]);

  /** The hold is over without sending (a slide off, the phone taking the touch, the app's own cancel): the words so far are kept. */
  const cancel = useCallback(() => over('cancel', drop()), [drop, over]);

  // The hold went away mid-hold (unmounted): it is over, and what onHoldStart took is given back.
  useEffect(
    () => () => {
      if (open.current > 0) {
        open.current = 0;
        callbacks.current.onHoldEnd?.({ cancelled: true, ended: 'cancel' });
      }
    },
    [],
  );

  // begin, finish and drop stay inside: a caller holds through press, release and cancel, so every end is handed on
  const { transcript, notice, setNotice, mode, mic, fellBack, input, supported } = hold;
  return { transcript, notice, setNotice, mode, mic, fellBack, input, supported, holding, press, release, cancel };
}

async function stopRecording(held: HeldRecording): Promise<Recording | undefined> {
  if (!(await held.started)) return undefined;
  try {
    return await held.recorder.stop();
  } catch {
    return undefined;
  }
}
