// transcriber.ts — how audio becomes text is the app's choice, and the hold asks it through one port: a
// Transcriber starts listening on press and its session's stop() is the release, as listen.ts's startListening
// does. browserSpeech is the browser's own speech recogniser, as Postern listens today: the words come as he
// speaks. transcribeRecording records the hold instead and, when he lets go, hands the recording to a function
// the app passes (its own speech-to-text service, say): the words come once, after the release.
import { DEFAULT_APP_NAME, isListenSupported, listenError, startListening, type ListenError, type ListenOptions, type ListenResult, type ListenStart, type MicInput } from './listen.js';
import { canRecord, VoiceRecorder, type Recording } from './recorder.js';

export interface Transcriber {
  /** True when this browser can do it; the composer shows no hold bar otherwise. */
  supported(): boolean;
  /** Begins listening now (on press). Never throws: a failure to start comes back as a value. */
  start(options: ListenOptions): ListenStart;
}

/** The browser's speech recogniser (SpeechRecognition), as Postern listens: on-device where offered, words as he speaks. */
export const browserSpeech: Transcriber = {
  supported: isListenSupported,
  start: startListening,
};

/**
 * Records the hold (on the chosen Bluetooth input when the hold opens one, else the default microphone) and,
 * on release, turns the recording into words with `transcribe`. A failure to record or to transcribe comes
 * back as a value, never a throw. `mode` is 'cloud': the audio goes wherever `transcribe` sends it.
 */
export function transcribeRecording(transcribe: (recording: Recording) => Promise<string>): Transcriber {
  return {
    supported: canRecord,
    start(options) {
      const app = options.appName ?? DEFAULT_APP_NAME;
      const recorder = new VoiceRecorder();
      let input: MicInput | undefined;
      let failure: ListenError | undefined;
      let aborted = false;
      let outcome: Promise<ListenResult> | undefined;
      const release = () => {
        const open = input;
        input = undefined;
        try {
          open?.close();
        } catch {
          // already closed
        }
      };
      const opening = (async (): Promise<boolean> => {
        input = options.openInput ? await options.openInput().catch(() => undefined) : undefined;
        if (aborted) {
          release();
          return false;
        }
        try {
          await recorder.start(input?.track);
        } catch {
          release();
          failure = listenError('not-allowed', app);
          options.onError?.(failure);
          return false;
        }
        if (aborted) {
          recorder.cancel();
          release();
          return false;
        }
        if (input) options.onInput?.(input.label);
        options.onStart?.();
        return true;
      })();
      const settle = async (): Promise<ListenResult> => {
        if (!(await opening)) return failure ? { ok: false, text: '', error: failure } : { ok: true, text: '', mode: 'cloud' };
        let recording: Recording;
        try {
          recording = await recorder.stop();
        } catch {
          return { ok: true, text: '', mode: 'cloud' };
        } finally {
          release();
        }
        try {
          const text = (await transcribe(recording)).trim();
          if (text) options.onInterim?.(text);
          options.onFinal?.(text);
          return { ok: true, text, mode: 'cloud' };
        } catch (err) {
          return { ok: false, text: '', error: { kind: 'other', message: err instanceof Error ? err.message : 'The words could not be made out.' } };
        }
      };
      return {
        ok: true,
        session: {
          mode: 'cloud',
          stop() {
            outcome ??= settle();
            return outcome;
          },
          abort() {
            aborted = true;
            outcome ??= Promise.resolve({ ok: true, text: '', mode: 'cloud' });
            if (recorder.recording) recorder.cancel();
            release();
          },
        },
      };
    },
  };
}
