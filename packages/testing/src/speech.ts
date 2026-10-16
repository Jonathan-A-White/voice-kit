// An honest speech fake: window.speechSynthesis and SpeechSynthesisUtterance that behave like Android Chrome in time.
// speak() queues; each utterance runs for a time its text sets (default 150 ms and 60 ms a word, divided by its rate)
// on a clock the test can fake, and fires start, a boundary for each word (charIndex, charLength), then end; pause()
// holds the current utterance and resume() carries on from where it was; cancel() ends the current one with error
// 'interrupted' and drops the queue with 'canceled'; getVoices() is empty until voiceschanged fires 50 ms after install.
// A log says what was spoken and when.
//
// installSpeech(target) puts the fake on a window (vitest: the jsdom window, or globalThis; fake timers move it).
// speechInitScript(options) is the same code as a string for Playwright's page.addInitScript, where the page's own
// timers (real, or Playwright's page.clock) move it. No DOM lib is needed: the target is handed in, nothing global is read
// but the timers, and only when they are used.

/** The time the fake runs on. The default reads the global timers and Date each time it is used, so fake timers installed later still move it. */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface FakeVoice {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

export interface SpeechOptions {
  /** Defaults to the global timers and Date. Cannot go into an init script (the page's own clock is used there). */
  clock?: Clock;
  /** Time an utterance takes for each word at rate 1. Default 60. */
  msPerWord?: number;
  /** Time an utterance takes before its first word, at rate 1. Default 150. */
  baseMs?: number;
  /** What getVoices() returns once voiceschanged has fired. Default: Google US English and Google ελληνικά. */
  voices?: FakeVoice[];
  /** How long after install voiceschanged fires. Default 50. */
  voicesDelayMs?: number;
}

export interface FakeSpeechEvent {
  type: string;
  target: unknown;
  utterance?: FakeUtterance;
  charIndex: number;
  charLength: number;
  /** Seconds of speaking so far. */
  elapsedTime: number;
  name: string;
  /** 'interrupted' (the current utterance) or 'canceled' (those queued behind it), on error events. */
  error?: string;
}

export type SpeechListener = (event: FakeSpeechEvent) => void;

export interface FakeUtterance {
  text: string;
  lang: string;
  voice: FakeVoice | null;
  rate: number;
  pitch: number;
  volume: number;
  onstart: SpeechListener | null;
  onend: SpeechListener | null;
  onerror: SpeechListener | null;
  onboundary: SpeechListener | null;
  onmark: SpeechListener | null;
  onpause: SpeechListener | null;
  onresume: SpeechListener | null;
  addEventListener(type: string, listener: SpeechListener): void;
  removeEventListener(type: string, listener: SpeechListener): void;
  dispatchEvent(event: { type: string }): boolean;
}

export interface FakeUtteranceConstructor {
  new (text?: string): FakeUtterance;
}

export interface FakeSpeechSynthesis {
  readonly speaking: boolean;
  readonly pending: boolean;
  readonly paused: boolean;
  onvoiceschanged: SpeechListener | null;
  speak(utterance: FakeUtterance): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  getVoices(): FakeVoice[];
  addEventListener(type: string, listener: SpeechListener): void;
  removeEventListener(type: string, listener: SpeechListener): void;
  dispatchEvent(event: { type: string }): boolean;
}

/** One utterance as the log tells it. Times are ms since install. */
export interface SpokenEntry {
  text: string;
  lang: string;
  rate: number;
  voice: string | null;
  queuedAt: number;
  startedAt: number | null;
  endedAt: number | null;
  outcome: 'queued' | 'speaking' | 'ended' | 'interrupted' | 'canceled';
}

export interface SpeechFake {
  synth: FakeSpeechSynthesis;
  Utterance: FakeUtteranceConstructor;
  /** Every utterance passed to speak(), in order. */
  log: SpokenEntry[];
  /** The text of each utterance that started, in order. */
  spoken(): string[];
  options: Required<Omit<SpeechOptions, 'clock'>> & { clock: Clock };
  /** Puts back what install replaced and stops the fake's timers. */
  uninstall(): void;
}

/** The options as an init script can carry them: everything but the clock. */
export type SpeechScriptOptions = Omit<SpeechOptions, 'clock'>;

/**
 * Installs the fake on `target` (default: the global object) and returns it.
 * This function must stay self-contained: speechInitScript() sends its source to a page.
 */
export function installSpeech(target: object = globalThis, options: SpeechOptions = {}): SpeechFake {
  type Obj = Record<string, unknown>;
  const host = target as Obj;
  const clock: Clock = options.clock ?? {
    now: () => Date.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const config = {
    msPerWord: options.msPerWord ?? 60,
    baseMs: options.baseMs ?? 150,
    voicesDelayMs: options.voicesDelayMs ?? 50,
    voices: options.voices ?? [
      { voiceURI: 'Google US English', name: 'Google US English', lang: 'en-US', localService: false, default: true },
      { voiceURI: 'Google ελληνικά', name: 'Google ελληνικά', lang: 'el-GR', localService: false, default: false },
    ],
    clock,
  };
  const installedAt = clock.now();
  const since = () => clock.now() - installedAt;

  class Emitter {
    #listeners: Record<string, SpeechListener[]> = {};
    addEventListener(type: string, listener: SpeechListener) {
      const list = (this.#listeners[type] ??= []);
      if (!list.includes(listener)) list.push(listener);
    }
    removeEventListener(type: string, listener: SpeechListener) {
      this.#listeners[type] = (this.#listeners[type] ?? []).filter((l) => l !== listener);
    }
    dispatchEvent(event: { type: string }) {
      const handler = (this as unknown as Obj)['on' + event.type];
      if (typeof handler === 'function') handler.call(this, event);
      for (const listener of [...(this.#listeners[event.type] ?? [])]) listener.call(this, event as FakeSpeechEvent);
      return true;
    }
  }

  class Utterance extends Emitter {
    text: string;
    lang = '';
    voice: FakeVoice | null = null;
    rate = 1;
    pitch = 1;
    volume = 1;
    onstart: SpeechListener | null = null;
    onend: SpeechListener | null = null;
    onerror: SpeechListener | null = null;
    onboundary: SpeechListener | null = null;
    onmark: SpeechListener | null = null;
    onpause: SpeechListener | null = null;
    onresume: SpeechListener | null = null;
    constructor(text = '') {
      super();
      this.text = String(text);
    }
  }

  interface Point {
    at: number;
    type: 'start' | 'boundary' | 'end';
    charIndex: number;
    charLength: number;
  }
  interface Current {
    u: Utterance;
    entry: SpokenEntry;
    points: Point[];
    idx: number;
    /** Ms of speaking done, in the utterance's own (rate-scaled) time. */
    progress: number;
    /** When the running stretch began; null while held. */
    runStart: number | null;
    timer: unknown;
  }

  const log: SpokenEntry[] = [];
  const queue: { u: Utterance; entry: SpokenEntry }[] = [];
  let current: Current | null = null;
  let paused = false;
  // The same array, of the same voice objects, until voiceschanged: as a phone's list is, so a useSyncExternalStore reader settles.
  let voiceList: FakeVoice[] = [];

  const send = (u: Utterance, type: string, extra: Partial<FakeSpeechEvent> = {}, elapsedMs = 0) => {
    u.dispatchEvent({ type, target: u, utterance: u, charIndex: 0, charLength: 0, elapsedTime: elapsedMs / 1000, name: '', ...extra } as FakeSpeechEvent);
  };

  const pointsOf = (u: Utterance): Point[] => {
    const rate = u.rate > 0 ? u.rate : 1;
    const words = [...u.text.matchAll(/\S+/g)];
    return [
      { at: 0, type: 'start', charIndex: 0, charLength: 0 },
      ...words.map((m, i): Point => ({ at: (config.baseMs + i * config.msPerWord) / rate, type: 'boundary', charIndex: m.index ?? 0, charLength: m[0].length })),
      { at: (config.baseMs + words.length * config.msPerWord) / rate, type: 'end', charIndex: 0, charLength: 0 },
    ];
  };

  // Carries on with the current utterance. With `inTick`, what is due at once happens now, in the timer that got us here, so
  // a chain of events due together takes no extra millisecond a timer of 0 would add; speak() and resume() always go through a timer.
  const run = (inTick = false) => {
    const cur = current;
    if (!cur || paused) return;
    if (cur.timer !== null) clock.clearTimeout(cur.timer);
    const delay = Math.max(0, cur.points[cur.idx].at - cur.progress);
    cur.runStart = clock.now();
    if (inTick && delay === 0) {
      cur.timer = null;
      fire(cur);
      return;
    }
    cur.timer = clock.setTimeout(() => fire(cur), delay);
  };

  const hold = () => {
    const cur = current;
    if (!cur) return;
    if (cur.timer !== null) clock.clearTimeout(cur.timer);
    cur.timer = null;
    if (cur.runStart !== null) cur.progress = Math.min(cur.points[cur.idx].at, cur.progress + (clock.now() - cur.runStart));
    cur.runStart = null;
  };

  const pump = (inTick = false) => {
    if (current || queue.length === 0) return;
    const next = queue.shift() as { u: Utterance; entry: SpokenEntry };
    current = { u: next.u, entry: next.entry, points: pointsOf(next.u), idx: 0, progress: 0, runStart: null, timer: null };
    run(inTick);
  };

  const fire = (cur: Current) => {
    if (current !== cur) return;
    const point = cur.points[cur.idx];
    cur.timer = null;
    cur.runStart = null;
    cur.progress = point.at;
    cur.idx++;
    if (point.type === 'end') {
      current = null;
      cur.entry.endedAt = since();
      cur.entry.outcome = 'ended';
      try {
        send(cur.u, 'end', {}, point.at);
      } finally {
        pump(true);
      }
      return;
    }
    if (point.type === 'start') {
      cur.entry.startedAt = since();
      cur.entry.outcome = 'speaking';
      send(cur.u, 'start', {}, point.at);
    } else {
      send(cur.u, 'boundary', { name: 'word', charIndex: point.charIndex, charLength: point.charLength }, point.at);
    }
    if (current === cur) run(true);
  };

  class Synth extends Emitter {
    onvoiceschanged: SpeechListener | null = null;
    get speaking() {
      return current !== null;
    }
    get pending() {
      return queue.length > 0;
    }
    get paused() {
      return paused;
    }
    speak(utterance: FakeUtterance) {
      if (!(utterance instanceof Utterance)) {
        throw new TypeError("Failed to execute 'speak' on 'SpeechSynthesis': parameter 1 is not of type 'SpeechSynthesisUtterance'.");
      }
      const entry: SpokenEntry = {
        text: utterance.text,
        lang: utterance.lang,
        rate: utterance.rate,
        voice: utterance.voice?.name ?? null,
        queuedAt: since(),
        startedAt: null,
        endedAt: null,
        outcome: 'queued',
      };
      log.push(entry);
      queue.push({ u: utterance, entry });
      pump();
    }
    cancel() {
      const cur = current;
      const waiting = queue.splice(0);
      hold();
      current = null;
      const at = since();
      if (cur) {
        cur.entry.endedAt = at;
        cur.entry.outcome = 'interrupted';
      }
      for (const w of waiting) {
        w.entry.endedAt = at;
        w.entry.outcome = 'canceled';
      }
      if (cur) send(cur.u, 'error', { error: 'interrupted' }, cur.progress);
      for (const w of waiting) send(w.u, 'error', { error: 'canceled' });
    }
    pause() {
      if (paused) return;
      paused = true;
      hold();
      if (current) send(current.u, 'pause', {}, current.progress);
    }
    resume() {
      if (!paused) return;
      paused = false;
      if (current) {
        send(current.u, 'resume', {}, current.progress);
        run();
      }
    }
    getVoices() {
      return voiceList;
    }
  }

  const synth = new Synth();
  const voicesTimer = clock.setTimeout(() => {
    voiceList = config.voices.map((v) => ({ ...v }));
    synth.dispatchEvent({ type: 'voiceschanged', target: synth } as FakeSpeechEvent);
  }, config.voicesDelayMs);

  // Put the fake on the target, remembering what was there.
  const replaced: { key: string; before: PropertyDescriptor | undefined }[] = [];
  const put = (key: string, value: unknown) => {
    replaced.push({ key, before: Object.getOwnPropertyDescriptor(host, key) });
    Object.defineProperty(host, key, { value, configurable: true, writable: true, enumerable: true });
  };
  put('speechSynthesis', synth);
  put('SpeechSynthesisUtterance', Utterance);

  const registry = (host.__bsvKitTesting ?? {}) as Obj;

  const fake: SpeechFake = {
    synth: synth as unknown as FakeSpeechSynthesis,
    Utterance: Utterance as unknown as FakeUtteranceConstructor,
    log,
    spoken: () => log.filter((e) => e.startedAt !== null).map((e) => e.text),
    options: config,
    uninstall() {
      clock.clearTimeout(voicesTimer);
      hold();
      current = null;
      queue.length = 0;
      for (const { key, before } of replaced.reverse()) {
        if (before) Object.defineProperty(host, key, before);
        else delete host[key];
      }
      replaced.length = 0;
      delete registry.speech;
      if (Object.keys(registry).length === 0) delete host.__bsvKitTesting;
    },
  };
  registry.speech = fake;
  host.__bsvKitTesting = registry;
  return fake;
}

/**
 * The fake as a string for Playwright: `await page.addInitScript(speechInitScript())`. It installs on the page's global
 * object before the page's own scripts run; reach the log from the test with
 * `page.evaluate(() => window.__bsvKitTesting.speech.spoken())`.
 */
export function speechInitScript(options: SpeechScriptOptions = {}): string {
  return `(${installSpeech.toString()})(globalThis, ${JSON.stringify(options)});`;
}
