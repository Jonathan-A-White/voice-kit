// The 20 tries panel's counts: wakes heard and minutes listened, kept in localStorage so they survive a reload. Say
// 'Hey Lampas' 20 times and the wakes beside it tell the misses; the wakes in the minutes you did not say it are false.

export const TRIES_KEY = 'wake-spike-tries';

export interface Tries {
  wakes: number;
  /** Seconds of audio the detector has heard. */
  seconds: number;
}

type TriesStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readTries(storage: TriesStorage | undefined): Tries {
  try {
    const parsed = JSON.parse(storage?.getItem(TRIES_KEY) ?? '{}') as Partial<Tries>;
    return { wakes: Number(parsed.wakes) > 0 ? Math.floor(Number(parsed.wakes)) : 0, seconds: Number(parsed.seconds) > 0 ? Number(parsed.seconds) : 0 };
  } catch {
    return { wakes: 0, seconds: 0 };
  }
}

export function saveTries(storage: TriesStorage | undefined, tries: Tries): void {
  try {
    storage?.setItem(TRIES_KEY, JSON.stringify(tries));
  } catch {
    /* kept in memory only */
  }
}

/** The panel's sentence for these counts. */
export function describeTries(tries: Tries, tried = 20): string {
  const minutes = (tries.seconds / 60).toFixed(2);
  if (tries.wakes >= tried) return `${tries.wakes} wakes in ${minutes} min: all ${tried} tries heard if you said it ${tried} times.`;
  return `${tries.wakes} wakes in ${minutes} min: if you said it ${tried} times, ${tried - tries.wakes} were missed.`;
}
