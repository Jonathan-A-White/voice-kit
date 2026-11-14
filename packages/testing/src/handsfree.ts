// A wake word for an app's tests. installWake(target) puts a handle on target.__bsvKitTesting.wake; the kit's own startWake
// (voice-kit/wake) looks there first, and while the handle is there it hands the call to it: no microphone is opened, no model is
// fetched or run, no AudioWorklet or Worker is made. The test says the wake word with say(), and reads listening (a startWake is
// open), starts (how many times startWake was called), tracks and liveTracks (the fake microphone tracks it handed out, clones
// included, and how many are not stopped); failWith(kind) makes every later startWake fail with that kind until failWith() clears it.
//
// startWake reads globalThis, so install on the global object (the default; in vitest that is the test's own global, with or
// without jsdom). wakeInitScript(options) is the same code as a string for Playwright's page.addInitScript: the page's own
// startWake then finds it. Opening takes openMs (100 by default) on the target's timers, as the real one takes a moment.
// No DOM lib is needed: the target is handed in.

/** The kinds a startWake failure can have (voice-kit/wake's WakeFailureKind). */
export type WakeFailKind = 'not-supported' | 'permission-denied' | 'no-microphone' | 'other';

export interface WakeFakeOptions {
  /** How long a startWake takes to open, in ms. Default 100. */
  openMs?: number;
  /** The fake microphone's name, on its tracks. Default 'Default - Fake microphone'. */
  label?: string;
}

/** A microphone track as the fake hands it out. */
export interface FakeWakeTrack {
  readonly kind: 'audio';
  readonly id: string;
  label: string;
  enabled: boolean;
  readonly muted: boolean;
  readonly readyState: 'live' | 'ended';
  onended: ((event: unknown) => void) | null;
  stop(): void;
  /** A new live track on the same microphone, counted as the fake's. */
  clone(): FakeWakeTrack;
  getSettings(): { deviceId: string; sampleRate: number; channelCount: number };
  addEventListener(type: string, listener: unknown): void;
  removeEventListener(type: string, listener: unknown): void;
}

/** A wake as the fake gives it to onWake (voice-kit/wake's Wake: the time in seconds, the score, the detector's window). */
export interface FakeWakeEvent {
  time: number;
  score: number;
  // quoted: this file never names the page's global window, not even as a key
  'window': number;
}

/** What startWake is handed; the fake reads only these. */
export interface FakeWakeOptions {
  onWake(wake: FakeWakeEvent): void;
  model?: unknown;
  stream?: { getAudioTracks(): unknown[] };
}

export interface WakeFake {
  /** Says the wake word: every open startWake's onWake is called once. False when none is open (nothing heard it). */
  say(): boolean;
  /** True while a startWake is open (resolved and not stopped). */
  readonly listening: boolean;
  /** How many times startWake was called while the fake was installed. */
  readonly starts: number;
  /** Every track the fake handed out, clones included, in order. */
  readonly tracks: FakeWakeTrack[];
  /** How many of them are not stopped. */
  readonly liveTracks: number;
  /** Every later startWake fails with `kind` (and its sentence), until failWith() with no kind. */
  failWith(kind?: WakeFailKind): void;
  /** The options, live: change openMs on the handle and the next start sees it. */
  options: Required<WakeFakeOptions>;
  /** The seam: startWake calls this, with its own options, when the fake is installed. Not for tests to call. */
  start(options: FakeWakeOptions): Promise<unknown>;
  /** Takes the handle away; startWake is the real one again. Open fake wakes are left as they are. */
  uninstall(): void;
}

/** Installs the fake wake on `target`. This function must stay self-contained: wakeInitScript() sends its source to a page. */
function mountWake(target: object, options: WakeFakeOptions): WakeFake {
  type Obj = Record<string, unknown>;
  const host = target as Obj;
  const config: Required<WakeFakeOptions> = { openMs: options.openMs ?? 100, label: options.label ?? 'Default - Fake microphone' };
  const timers = host as unknown as { setTimeout?: (fn: () => void, ms: number) => unknown };
  const later = (ms: number, fn: () => void) => (typeof timers.setTimeout === 'function' ? timers.setTimeout(fn, ms) : globalThis.setTimeout(fn, ms));
  const now = () => (globalThis.performance ? globalThis.performance.now() : Date.now());
  const messages: Record<WakeFailKind, string> = {
    'not-supported': 'This browser has no AudioWorklet or Web Worker.',
    'permission-denied': 'The microphone was not allowed.',
    'no-microphone': 'There is no microphone to open.',
    other: 'The wake failed (the fake was told to fail).',
  };

  const tracks: FakeWakeTrack[] = [];
  let counter = 0;
  const makeTrack = (): FakeWakeTrack => {
    let state: 'live' | 'ended' = 'live';
    const track: FakeWakeTrack = {
      kind: 'audio',
      id: `wake-track-${++counter}`,
      label: config.label,
      enabled: true,
      muted: false,
      get readyState() {
        return state;
      },
      onended: null,
      stop() {
        state = 'ended';
      },
      clone: () => makeTrack(),
      getSettings: () => ({ deviceId: 'default', sampleRate: 48000, channelCount: 1 }),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    tracks.push(track);
    return track;
  };

  const open = new Set<FakeWakeOptions>();
  let starts = 0;
  let failing: WakeFailKind | undefined;

  const fake: WakeFake = {
    say() {
      const listeners = [...open];
      for (const o of listeners) o.onWake({ time: now() / 1000, score: 0.99, 'window': 0 });
      return listeners.length > 0;
    },
    get listening() {
      return open.size > 0;
    },
    get starts() {
      return starts;
    },
    tracks,
    get liveTracks() {
      return tracks.filter((t) => t.readyState === 'live').length;
    },
    failWith(kind) {
      failing = kind;
    },
    options: config,
    start(wakeOptions) {
      starts++;
      return new Promise((resolve) => {
        later(config.openMs, () => {
          if (failing) {
            resolve({ ok: false, kind: failing, message: messages[failing] });
            return;
          }
          const given = wakeOptions.stream;
          const track = given ? (given.getAudioTracks()[0] as FakeWakeTrack) : makeTrack();
          const stream = given ?? {
            id: `wake-stream-${counter}`,
            get active() {
              return track.readyState === 'live';
            },
            getTracks: () => [track],
            getAudioTracks: () => [track],
            getVideoTracks: () => [],
          };
          const entry = { onWake: (wake: FakeWakeEvent) => wakeOptions.onWake(wake) };
          open.add(entry);
          let stopped = false;
          resolve({
            ok: true,
            track,
            stream,
            inputRate: 48000,
            model: wakeOptions.model,
            stop() {
              if (stopped) return;
              stopped = true;
              open.delete(entry);
              if (!given) track.stop();
            },
          });
        });
      });
    },
    uninstall() {
      const registry = host.__bsvKitTesting as Obj | undefined;
      if (!registry) return;
      if (registry.wake === fake) delete registry.wake;
      if (Object.keys(registry).length === 0) delete host.__bsvKitTesting;
    },
  };
  const registry = (host.__bsvKitTesting ?? {}) as Obj;
  registry.wake = fake;
  host.__bsvKitTesting = registry;
  return fake;
}

/** Installs the fake wake on `target` (default and usual: the global object, where startWake looks) and returns its handle. */
export function installWake(target: object = globalThis, options: WakeFakeOptions = {}): WakeFake {
  return mountWake(target, options);
}

/**
 * The fake as a string for Playwright: `await page.addInitScript(wakeInitScript())`. It installs on the page's global object
 * before the page's own scripts run; say the wake word from the test with `page.evaluate(() => window.__bsvKitTesting.wake.say())`.
 */
export function wakeInitScript(options: WakeFakeOptions = {}): string {
  return `(${mountWake.toString()})(globalThis, ${JSON.stringify(options)});`;
}
