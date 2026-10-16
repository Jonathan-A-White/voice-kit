// @vitest-environment jsdom
// The read-aloud engine, lifted from Postern's src/services/speech.ts and its tests: a text is spoken a sentence at a time,
// Pause keeps the sentence reached, Resume speaks on from it, Restart goes back to the first, Stop clears; a hidden page pauses;
// every utterance names its language and, when the phone lists one, a voice for it. The synthesiser is voice-kit/testing's
// honest one: it queues, starts an utterance after speak(), fires start/boundary/end in time and reports a cancelled one as an error.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSpeech, isPausedOn, isSpeaking, isSupported, pause, restart, resume, speak, speechText, stop, subscribe, whenDone } from '../src/index.js';
import { installHonestSpeech, voiceOf, type HonestSpeech, type HonestSpeechOptions } from './support/honest-speech.js';

let synth: HonestSpeech | null = null;

function install(options: HonestSpeechOptions = {}): HonestSpeech {
  synth = installHonestSpeech(options);
  return synth;
}

afterEach(() => {
  stop();
  synth?.uninstall();
  synth = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const THREE = 'First thing. Second thing. Third thing.';

describe('support', () => {
  it('reports unsupported when the phone has no speechSynthesis, supported once it has', () => {
    expect(isSupported()).toBe(false);
    install();
    expect(isSupported()).toBe(true);
  });
});

describe('pause, resume, restart, stop', () => {
  beforeEach(() => {
    install();
  });

  it('speaks a multi-sentence text as one utterance per sentence and reports the sentence reached', () => {
    speak(THREE, { key: 'a' });
    synth!.advance(0);
    expect(synth!.waiting()).toEqual(['First thing.', 'Second thing.', 'Third thing.']);
    expect(synth!.log).toHaveLength(3);
    expect(getSpeech()).toMatchObject({ status: 'playing', key: 'a', index: 0, count: 3 });
    synth!.finish();
    expect(getSpeech().index).toBe(1);
  });

  it('cuts at line ends and after ! ? and an ellipsis, not at a decimal point', () => {
    speak('Is it 3.5 dollars? Yes!\nOk… Fine.', { key: 'a' });
    expect(synth!.waiting()).toEqual(['Is it 3.5 dollars?', 'Yes!', 'Ok…', 'Fine.']);
  });

  it('a one-sentence text is one utterance', () => {
    speak('hello', { key: 'a' });
    expect(synth!.waiting()).toEqual(['hello']);
    expect(getSpeech().count).toBe(1);
  });

  it('pause keeps the sentence and does not report the speech as ended', () => {
    const onEnd = vi.fn();
    speak(THREE, { key: 'a', onEnd });
    synth!.advance(0);
    synth!.finish();
    const nativePause = vi.spyOn(synth!.synth, 'pause');
    pause();
    expect(getSpeech()).toMatchObject({ status: 'paused', key: 'a', index: 1, count: 3 });
    expect(synth!.waiting()).toEqual([]);
    expect(nativePause).not.toHaveBeenCalled(); // Android Chrome does not honour speechSynthesis.pause()
    expect(onEnd).not.toHaveBeenCalled();
    expect(isSpeaking('a')).toBe(true);
  });

  it('resume speaks on from the sentence it was paused in', () => {
    speak(THREE, { key: 'a' });
    synth!.advance(0);
    synth!.finish();
    pause();
    resume();
    expect(getSpeech().status).toBe('playing');
    expect(synth!.waiting()).toEqual(['Second thing.', 'Third thing.']);
  });

  it('a speech that is paused and resumed still ends once, at its last sentence', () => {
    const onEnd = vi.fn();
    speak(THREE, { key: 'a', onEnd });
    synth!.advance(0);
    pause();
    resume();
    synth!.advance(0);
    synth!.finish();
    synth!.finish();
    expect(onEnd).not.toHaveBeenCalled();
    synth!.finish();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(getSpeech().status).toBe('idle');
  });

  it('restart speaks again from the first sentence, from playing or from paused', () => {
    speak(THREE, { key: 'a' });
    synth!.advance(0);
    synth!.finish();
    restart();
    expect(getSpeech()).toMatchObject({ status: 'playing', index: 0 });
    expect(synth!.waiting()).toEqual(['First thing.', 'Second thing.', 'Third thing.']);
    synth!.advance(0);
    synth!.finish();
    pause();
    restart();
    expect(synth!.waiting()).toEqual(['First thing.', 'Second thing.', 'Third thing.']);
  });

  it('stop clears the speech: nothing is kept to resume', () => {
    speak(THREE, { key: 'a' });
    synth!.advance(0);
    pause();
    stop();
    expect(getSpeech()).toMatchObject({ status: 'idle', key: null });
    expect(isSpeaking('a')).toBe(false);
    resume();
    expect(synth!.waiting()).toEqual([]);
  });

  it('stop cancels what the synthesiser holds', () => {
    const cancel = vi.spyOn(synth!.synth, 'cancel');
    stop();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('the cancelled sentence reporting its error late does not end or move the speech', () => {
    const onEnd = vi.fn();
    speak(THREE, { key: 'a', onEnd });
    synth!.advance(0);
    pause();
    synth!.advance(1000);
    expect(onEnd).not.toHaveBeenCalled();
    expect(getSpeech()).toMatchObject({ status: 'paused', index: 0 });
  });

  it('a new speak replaces a paused one', () => {
    speak(THREE, { key: 'a' });
    synth!.advance(0);
    pause();
    speak('Another one.', { key: 'b' });
    expect(getSpeech()).toMatchObject({ status: 'playing', key: 'b', count: 1 });
    expect(synth!.waiting()).toEqual(['Another one.']);
  });

  it('speak with resumeIfPaused continues the paused speech of the same key and text, handing it the new end callback', () => {
    const first = vi.fn();
    const second = vi.fn();
    speak(THREE, { key: 'a', onEnd: first });
    synth!.advance(0);
    synth!.finish();
    pause();
    expect(isPausedOn('a', THREE)).toBe(true);
    expect(isPausedOn('a', 'other')).toBe(false);
    speak(THREE, { key: 'a', onEnd: second, resumeIfPaused: true });
    expect(synth!.waiting()).toEqual(['Second thing.', 'Third thing.']);
    synth!.advance(0);
    synth!.finish();
    synth!.finish();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('speak with resumeIfPaused starts from the top when nothing is paused', () => {
    speak(THREE, { key: 'a', resumeIfPaused: true });
    expect(synth!.waiting()).toHaveLength(3);
  });

  it('a hidden page pauses what is speaking, and showing it again does not resume it', () => {
    speak(THREE, { key: 'a' });
    synth!.advance(0);
    synth!.finish();
    let state: DocumentVisibilityState = 'hidden';
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(getSpeech()).toMatchObject({ status: 'paused', index: 1 });
    state = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(getSpeech().status).toBe('paused');
    spy.mockRestore();
  });

  it('whenDone runs once the speech is over for good, not when it is only paused', () => {
    const done = vi.fn();
    speak('One.', { key: 'a' });
    whenDone('a', done);
    pause();
    expect(done).not.toHaveBeenCalled();
    resume();
    synth!.advance(0);
    synth!.finish();
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe('who is speaking, by a key', () => {
  beforeEach(() => {
    install();
  });

  it('says the key that started the speech is speaking, and no other', () => {
    speak('one', { key: 'a' });
    expect(isSpeaking('a')).toBe(true);
    expect(isSpeaking('b')).toBe(false);
  });

  it('a speak() with no key speaks and names nobody', () => {
    speak('one');
    expect(isSpeaking('a')).toBe(false);
  });

  it('clears when the utterance ends, and still calls onEnd', () => {
    const onEnd = vi.fn();
    speak('one', { key: 'a', onEnd });
    synth!.finish();
    expect(isSpeaking('a')).toBe(false);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('clears when the utterance errors (another app takes the speech)', () => {
    speak('one', { key: 'a' });
    synth!.advance(0);
    synth!.synth.cancel();
    expect(isSpeaking('a')).toBe(false);
  });

  it('starting another key hands the speaking over, and the cancelled one ending late changes nothing', () => {
    speak('one', { key: 'a' });
    synth!.advance(0);
    speak('two', { key: 'b' });
    expect(synth!.log[0].outcome).toBe('interrupted');
    expect(isSpeaking('a')).toBe(false);
    expect(isSpeaking('b')).toBe(true);
    synth!.finish();
    expect(isSpeaking('b')).toBe(false);
  });

  it('tells subscribers on every change and stops when they unsubscribe', () => {
    const listener = vi.fn();
    const off = subscribe(listener);
    speak('one', { key: 'a' });
    expect(listener).toHaveBeenCalledTimes(1);
    synth!.finish();
    expect(listener).toHaveBeenCalledTimes(2);
    off();
    speak('two', { key: 'a' });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('hands out the same snapshot object until something changes', () => {
    const before = getSpeech();
    expect(getSpeech()).toBe(before);
    speak('one', { key: 'a' });
    expect(getSpeech()).not.toBe(before);
    const during = getSpeech();
    expect(getSpeech()).toBe(during);
  });
});

describe('the language and voice of each utterance', () => {
  const ENGLISH = 'The tutor said hello.';
  const GREEK = 'Καλημέρα σας, τι κάνετε.';
  const HEBREW = 'שלום עולם, מה שלומך?';

  it('gives Greek, Hebrew and English text each its own lang and a matching voice', () => {
    vi.stubGlobal('navigator', { language: 'en' });
    install({ voices: ['en-US', 'el-GR', 'he-IL'].map(voiceOf) });
    speak(ENGLISH);
    speak(GREEK);
    speak(HEBREW);
    expect(synth!.log.map((e) => [e.lang, e.voice])).toEqual([
      ['en-US', 'en-US'],
      ['el-GR', 'el-GR'],
      ['he-IL', 'he-IL'],
    ]);
  });

  it('gives lang alone when no listed voice matches', () => {
    vi.stubGlobal('navigator', { language: 'en' });
    install({ voices: [voiceOf('en-US')] });
    speak(GREEK);
    speak(HEBREW);
    expect(synth!.log.map((e) => [e.lang, e.voice])).toEqual([
      ['el-GR', null],
      ['he-IL', null],
    ]);
  });

  it('names a language even when the phone lists no voices at all', () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { language: 'en' });
    install({ voices: [], voicesLate: true });
    speak(GREEK);
    vi.advanceTimersByTime(2000);
    expect(synth!.log).toHaveLength(1);
    expect(synth!.log[0]).toMatchObject({ lang: 'el-GR', voice: null });
  });

  it('chooses the language sentence by sentence in a text that mixes them', () => {
    install({ voices: ['en-US', 'el-GR'].map(voiceOf) });
    speak(`Say it like this. ${GREEK} Then again.`);
    expect(synth!.log.map((e) => [e.text, e.lang])).toEqual([
      ['Say it like this.', 'en-US'],
      [GREEK, 'el-GR'],
      ['Then again.', 'en-US'],
    ]);
  });

  it('reads a sentence by the script most of its letters are in, a quoted foreign word not turning it', () => {
    install();
    speak('He pointed at "Καλημέρα" and smiled.');
    expect(synth!.log[0].lang).toBe('en-US');
  });

  it('reads a sentence with no letters in the language of the text around it', () => {
    install();
    speak(`${GREEK} 42.`);
    expect(synth!.log.map((e) => e.lang)).toEqual(['el-GR', 'el-GR']);
  });

  it('reads Latin text in the phone\'s language: a bare en is en-US, a full tag is kept, and a voice for it wins', () => {
    vi.stubGlobal('navigator', { language: 'en-GB' });
    install({ voices: ['fr-FR', 'en-GB', 'en-US'].map(voiceOf) });
    speak('hello');
    expect(synth!.log[0]).toMatchObject({ lang: 'en-GB', voice: 'en-GB' });
  });

  it('reads Latin text as en-US when the phone names no language, or names Greek', () => {
    vi.stubGlobal('navigator', {});
    install();
    speak('hello');
    vi.stubGlobal('navigator', { language: 'el-GR' });
    speak('hello again');
    expect(synth!.log.map((e) => e.lang)).toEqual(['en-US', 'en-US']);
  });

  it('lets the app name the language of its Latin text', () => {
    install({ voices: ['en-US', 'fr-FR'].map(voiceOf) });
    speak('Bonjour tout le monde.', { lang: 'fr-FR' });
    expect(synth!.log[0]).toMatchObject({ lang: 'fr-FR', voice: 'fr-FR' });
  });

  it('never gives English the Greek voice listed first', () => {
    vi.stubGlobal('navigator', { language: 'en' });
    install({ voices: ['el-GR', 'en-US'].map(voiceOf) });
    speak('hello');
    expect(synth!.log[0].voice).toBe('en-US');
  });

  it('matches a voice whose tag uses an underscore, and the old iw tag of a Hebrew voice', () => {
    install({ voices: ['el_GR', 'iw_IL'].map(voiceOf) });
    speak(GREEK);
    speak(HEBREW);
    expect(synth!.log.map((e) => e.voice)).toEqual(['el_GR', 'iw_IL']);
  });

  it('settles on one voice for a whole text in one language', () => {
    install({ voices: ['en-US'].map(voiceOf) });
    speak(THREE);
    expect(new Set(synth!.log.map((e) => e.voice))).toEqual(new Set(['en-US']));
  });

  describe('when the voice list is still empty', () => {
    it('waits for voiceschanged, then gives the utterance the matching voice', () => {
      vi.stubGlobal('navigator', { language: 'en' });
      install({ voices: ['el-GR', 'en-US'].map(voiceOf), voicesLate: true });
      speak('hello');
      expect(synth!.log).toHaveLength(0);
      synth!.advance(synth!.options.voicesDelayMs);
      expect(synth!.log).toHaveLength(1);
      expect(synth!.log[0]).toMatchObject({ voice: 'en-US', lang: 'en-US' });
    });

    it('speaks only once when the voices load after the wait passed', () => {
      vi.useFakeTimers();
      install({ voicesLate: true });
      speak('hello');
      vi.advanceTimersByTime(2000);
      synth!.advance(synth!.options.voicesDelayMs);
      expect(synth!.log).toHaveLength(1);
    });

    it('stop while waiting means the utterance is never spoken', () => {
      install({ voicesLate: true });
      speak('hello');
      stop();
      synth!.advance(synth!.options.voicesDelayMs);
      expect(synth!.log).toHaveLength(0);
    });

    it('a second speak while waiting replaces the first', () => {
      install({ voicesLate: true });
      speak('first');
      speak('second');
      synth!.advance(synth!.options.voicesDelayMs);
      expect(synth!.log).toHaveLength(1);
      expect(synth!.log[0].text).toBe('second');
    });
  });
});

describe('speechText: what is spoken is not what is shown', () => {
  it('drops a bare URL and keeps the punctuation after it', () => {
    expect(speechText('see https://example.com/x')).toBe('see');
    expect(speechText('Open https://example.com/a?b=1, then reply.')).toBe('Open, then reply.');
  });

  it('leaves a text with no URL unchanged, line breaks included', () => {
    const plain = 'Three things landed.\n\n  - one, two,  three';
    expect(speechText(plain)).toBe(plain);
  });

  it('speak() hands the shaped text to the synthesiser, after the app\'s own prepare', () => {
    install();
    speak('Landed ticket 12, see https://example.com/12.', { prepare: (text) => text.replace('ticket 12', 'the ticket') });
    expect(synth!.log[0].text).toBe('Landed the ticket, see.');
  });
});
