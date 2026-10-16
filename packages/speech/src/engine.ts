// engine.ts — Postern's read-aloud engine (src/services/speech.ts), lifted: reads a message or question aloud with the phone's
// own speechSynthesis (Web Speech API). Nothing here reaches the network — the text is only ever spoken locally.
import { languageOf, latinLang, preferredVoice } from './lang.js';

export function isSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** How long the first tap waits for the phone to list its voices before it speaks with the language alone. */
export const VOICES_WAIT_MS = 1000;

// A phone that listed no voices within the wait is not waited on again, so each tap is not slowed.
const gaveUpWaiting = new WeakSet<object>();

// What is spoken is not what is shown (Postern's mw-gq6.223): a bare URL is noise on a train, so it is cut before speaking;
// the screen keeps its link. An app that shows more such things (ids, markup) rewrites them with the `prepare` option.
const URL_RE = /https?:\/\/[^\s<>()[\]]+/g;

/** `text` as it is said: bare URLs dropped (their closing punctuation kept) and the gaps they leave closed. A text with no URL is returned as it came. */
export function speechText(text: string): string {
  let changed = false;
  const out = text.replace(URL_RE, (match: string) => {
    changed = true;
    return /[.,;:!?]+$/.exec(match)?.[0] ?? '';
  });
  if (!changed) return text;
  return out
    .replace(/[([{][ \t]*[)\]}]/g, '') // brackets left empty
    .replace(/,[ \t]*(?:,[ \t]*)+/g, ', ') // 'a, , b' from two links in a row
    .replace(/([:;(])[ \t]*,[ \t]*/g, '$1 ') // 'Links: , x' from a dropped first link
    .replace(/^[ \t]*,[ \t]*/gm, '') // a comma left at the start of a line
    .replace(/[ \t]+([,.;:!?])/g, '$1') // space left before punctuation
    .replace(/[:;,]+([ \t]*[.!?])/g, '$1') // 'Links:.' -> 'Links.'
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+|[ \t]+$/gm, '')
    .trim();
}

export interface SpeakOptions {
  onEnd?: () => void;
  /** Who started this speech, so that speaker's button can show Stop while it reads (Postern's mw-ym1qi9.1). */
  key?: string;
  /** Carry on from the kept sentence when this same key and text were paused, handing the speech this `onEnd`; otherwise start at the top. */
  resumeIfPaused?: boolean;
  /** What text in Latin letters is read in (default: the phone's language; en-US for a bare 'en'). Greek and Hebrew text is always read in its own language. */
  lang?: string;
  /** Rewrites the text before it is cut into sentences and spoken (an app's ids and markup into words); `isPausedOn` still compares the text as given. */
  prepare?: (text: string) => string;
}

export type SpeechStatus = 'idle' | 'playing' | 'paused';

/** What is speaking now: whose it is, whether it plays or waits paused, and the sentence reached of the sentences it has. */
export interface SpeechState {
  status: SpeechStatus;
  key: string | null;
  index: number;
  count: number;
}

const IDLE: SpeechState = { status: 'idle', key: null, index: 0, count: 0 };

// What is spoken is split into sentences, queued on the synthesiser at once (so every speak() still
// runs inside the tap) and tracked by each one's start and end: the sentence reached is the position a
// pause keeps. Pausing cancels the queue and Resume queues the sentences from the kept one, because
// Android Chrome does not honour speechSynthesis.pause()/resume() (Postern's mw-q6n8m0.9). A cancelled utterance
// reports its end late, after the next speech began, so every utterance belongs to an epoch and only the
// current epoch may move the position or end the speech.
interface Reading {
  key: string | null;
  source: string;
  /** The text as given, before `prepare` and the links were turned into words: what a screen compares against its own. */
  raw: string;
  sentences: string[];
  /** What Latin-letter text is read in, and what a sentence with no letters is read in (the language of the whole text). */
  latin: string;
  textLang: string;
  index: number;
  status: 'playing' | 'paused';
  onEnd?: () => void;
  /** What a screen that has gone wants done when this reading is over for good (it ended, was stopped or was replaced), not when it is only paused. */
  done: Array<() => void>;
}

let reading: Reading | null = null;
let epoch = 0;
let snapshot: SpeechState = IDLE;
const listeners = new Set<() => void>();

function publish(): void {
  const next: SpeechState = reading ? { status: reading.status, key: reading.key, index: reading.index, count: reading.sentences.length } : IDLE;
  if (next.status === snapshot.status && next.key === snapshot.key && next.index === snapshot.index && next.count === snapshot.count) return;
  snapshot = next;
  for (const listener of [...listeners]) listener();
}

/** Calls `listener` whenever what is speaking changes; returns the unsubscribe. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What is speaking now; the same object until it changes, so a component may read it with useSyncExternalStore. */
export function getSpeech(): SpeechState {
  return snapshot;
}

/** True while the speech started under `key` is reading or paused (a paused one is still its speaker's to Resume or Stop). */
export function isSpeaking(key: string): boolean {
  return reading?.key === key;
}

/** True while the speech started under `key` waits paused on exactly this `text`, so a screen coming back can offer Resume rather than start over. */
export function isPausedOn(key: string, text: string): boolean {
  return reading?.status === 'paused' && reading.key === key && reading.raw === text;
}

/** Runs `fn` once the speech under `key` is over for good (played out, stopped or replaced); a pause does not count. For a screen that was left while it was paused. */
export function whenDone(key: string, fn: () => void): void {
  if (reading?.key === key) reading.done.push(fn);
}

function over(ended: Reading | null): void {
  for (const fn of ended?.done.splice(0) ?? []) fn();
}

/** `text` as sentences: cut after . ! ? or an ellipsis followed by a space, and at line ends. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

// The speak still waiting for the voice list, so a stop or a newer speak can drop it.
let waiting: { cancel: () => void } | null = null;

function dropWaiting(): void {
  const pending = waiting;
  waiting = null;
  pending?.cancel();
}

/** Calls `ready` at once when voices are listed (or cannot be waited for), else once they load or the wait ends. */
function whenVoicesListed(synth: SpeechSynthesis, ready: () => void): void {
  if (synth.getVoices().length > 0 || typeof synth.addEventListener !== 'function' || gaveUpWaiting.has(synth)) {
    ready();
    return;
  }
  const done = () => {
    synth.removeEventListener('voiceschanged', onChanged);
    clearTimeout(timer);
    if (waiting === handle) waiting = null;
  };
  const onChanged = () => {
    if (synth.getVoices().length === 0) return;
    done();
    ready();
  };
  const handle = { cancel: done };
  waiting = handle;
  synth.addEventListener('voiceschanged', onChanged);
  const timer = setTimeout(() => {
    gaveUpWaiting.add(synth);
    done();
    ready();
  }, VOICES_WAIT_MS);
}

/** Queues `reading`'s sentences from its position, once the phone's voices are listed; each names its own language and voice. */
function play(synth: SpeechSynthesis, current: Reading): void {
  const mine = epoch;
  whenVoicesListed(synth, () => {
    if (mine !== epoch) return;
    const voices = synth.getVoices();
    for (let i = current.index; i < current.sentences.length; i += 1) {
      const utterance = new SpeechSynthesisUtterance(current.sentences[i]);
      const lang = languageOf(current.sentences[i], { lang: current.latin, fallback: current.textLang });
      utterance.lang = lang;
      const voice = preferredVoice(voices, lang);
      if (voice) utterance.voice = voice;
      const reached = (index: number) => {
        if (mine !== epoch || index <= current.index) return;
        current.index = index;
        publish();
      };
      utterance.onstart = () => reached(i);
      utterance.onend = () => {
        if (mine !== epoch) return;
        if (i < current.sentences.length - 1) {
          reached(i + 1);
          return;
        }
        reading = null;
        publish();
        over(current);
        current.onEnd?.();
      };
      utterance.onerror = () => {
        if (mine !== epoch) return;
        reading = null;
        publish();
      };
      synth.speak(utterance);
    }
  });
}

/** Cancels any utterance already speaking, then speaks `text`, sentence by sentence. Does nothing when the phone cannot speak (see isSupported). */
export function speak(text: string, options: SpeakOptions = {}): void {
  if (!isSupported()) return;
  const synth = window.speechSynthesis;
  const key = options.key ?? null;
  const spoken = speechText(options.prepare ? options.prepare(text) : text);
  if (options.resumeIfPaused && reading && reading.key === key && reading.source === spoken) {
    // The same speech, kept paused (or still playing) across a screen change: carry on, handing it the new `onEnd`.
    reading.onEnd = options.onEnd;
    if (reading.status === 'playing') return;
    dropWaiting();
    epoch += 1;
    reading.status = 'playing';
    publish();
    synth.cancel();
    play(synth, reading);
    return;
  }
  dropWaiting();
  epoch += 1;
  const replaced = reading;
  synth.cancel();
  const sentences = sentencesOf(spoken);
  const latin = latinLang(options.lang);
  reading = {
    key,
    source: spoken,
    raw: text,
    sentences: sentences.length > 0 ? sentences : [spoken],
    latin,
    textLang: languageOf(spoken, { lang: latin }),
    index: 0,
    status: 'playing',
    onEnd: options.onEnd,
    done: [],
  };
  publish();
  over(replaced);
  play(synth, reading);
}

/** Pauses what is speaking where it is: the sentence reached is kept for resume(). */
export function pause(): void {
  if (reading?.status !== 'playing') return;
  dropWaiting();
  epoch += 1;
  reading.status = 'paused';
  publish();
  if (isSupported()) window.speechSynthesis.cancel();
}

/** Speaks on from the sentence a pause kept. */
export function resume(): void {
  if (reading?.status !== 'paused' || !isSupported()) return;
  epoch += 1;
  reading.status = 'playing';
  publish();
  play(window.speechSynthesis, reading);
}

/** Speaks the same text again from its first sentence, whether it plays or is paused. */
export function restart(): void {
  if (!reading || !isSupported()) return;
  dropWaiting();
  epoch += 1;
  reading.index = 0;
  reading.status = 'playing';
  publish();
  window.speechSynthesis.cancel();
  play(window.speechSynthesis, reading);
}

export function stop(): void {
  dropWaiting();
  epoch += 1;
  const ended = reading;
  reading = null;
  publish();
  over(ended);
  if (!isSupported()) return;
  window.speechSynthesis.cancel();
}

// A page that goes hidden pauses what it is saying (Android suspends its voice anyway); coming back
// leaves it paused, for the listener to Resume where it stopped.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') pause();
  });
}
