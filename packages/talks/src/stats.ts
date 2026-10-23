// stats.ts (mw-t3xu9a.2) — what the tutor client learns from its own record, by counting. The Governor's words: the client keeps
// statistics, the app keeps them, a nightly grist adjusts the weights, and we track whether ask-backs go down. So: no model, only
// counts over the TutorStore's record. A screen's up-front list is the core facts plus the facts asked back there at least
// `askBacks` times in its last `turns` turns (2 in 50, provisional) until a list is applied (applyWeights, by the nightly grist
// or by the app), which then stands; the rate of ask-backs per 100 turns before and after each applied list says whether it
// helped; and weightsReport() is the one thing the nightly grist reads.
import type { Registry } from './registry.js';
import type { TalkStore, TutorRecord, TutorStore } from './store.js';

/** The facts asked back for at least this many times in the window go up front. PROVISIONAL (the Mayor's guess). */
export const DEFAULT_ASK_BACKS = 2;
/** The window: a screen's last this many turns. PROVISIONAL. */
export const DEFAULT_WINDOW_TURNS = 50;

/** Who applied a list: the nightly grist, or the app itself. */
export type WeightsSource = 'grist' | 'app';

export interface LearnOptions {
  /** How many times a fact must have been asked back in the window to go up front: 2 unless given. */
  askBacks?: number;
  /** How many of a screen's last turns the window holds: 50 unless given. */
  turns?: number;
}

/** What one screen's record adds up to, all of it. */
export interface ScreenStats {
  /** The turns taken there. */
  turns: number;
  /** Ask-backs by fact name. */
  askBacks: Record<string, number>;
  /** Misses by what was wanted. */
  misses: Record<string, number>;
}

/** A list applied for a screen: when, by whom, and what was applied (names that are facts and not core). `ignored` are the names left out. */
export interface Applied {
  at: number;
  screen: string;
  source: WeightsSource;
  names: string[];
  ignored: string[];
}

/** The rate of ask-backs per 100 turns before and after the latest applied list on a screen: undefined for a span with no turns. */
export interface Change {
  /** When the list was applied. */
  at: number;
  source: WeightsSource;
  /** Over the time under the list before it (back to the one applied before, else to the start of the record). */
  before: number | undefined;
  /** Since it was applied. */
  after: number | undefined;
}

/** One screen as the nightly grist reads it. */
export interface ScreenReport {
  /** Turns taken there, all of the record. */
  turns: number;
  /** Turns in the window (the last `turns` of the options). */
  windowTurns: number;
  /** Ask-backs by fact name in the window: what the counted list is made of. */
  counts: Record<string, number>;
  /** The list read up front now: core facts first. */
  upFront: string[];
  /** The latest applied list, when one was. */
  applied?: { at: number; source: WeightsSource; names: string[] };
  /** Ask-backs per 100 turns: over all of the record, and before and after the latest applied list. */
  rate: { overall: number | undefined; before?: number | undefined; after?: number | undefined };
}

/** What was wanted that the app did not have or would not do, on a screen, since the last run. */
export interface MissReport {
  screen: string;
  name: string;
  count: number;
  /** The latest reason. */
  why: string;
}

/** What the nightly grist reads (and what decides whether it has anything to ask). */
export interface WeightsReport {
  /** The time of the last run this report is since. */
  since: number;
  /** When the report was made. */
  at: number;
  /** False when no ask-back, miss or applied list is newer than `since`: the run has nothing to ask. */
  changed: boolean;
  screens: Record<string, ScreenReport>;
  /** The misses newer than `since`, by screen and name. */
  misses: MissReport[];
}

export interface Stats {
  /** Turns, ask-backs and misses per screen (all of the record), for one screen or all; a screen with no record is not there. */
  stats(screen?: string): Promise<Record<string, ScreenStats>>;
  /** The names read up front on `screen`: the core facts, then the applied list, else the one set by hand, else the counted. */
  upFront(screen: string): Promise<string[]>;
  /** Records each screen's list with `at` (now unless given) and `source`, and makes it the list `upFront` reads. */
  applyWeights(lists: Record<string, string[]>, from: WeightsSource, at?: number): Promise<Applied[]>;
  /** Ask-backs per 100 turns on `screen` in [since, until); undefined when there were no turns. */
  rate(screen: string, since: number, until?: number): Promise<number | undefined>;
  /** The rate before and after the latest applied list on `screen`; undefined when none was applied. */
  change(screen: string): Promise<Change | undefined>;
  weightsReport(since: number): Promise<WeightsReport>;
}

export interface StatsOptions extends LearnOptions {
  store: TalkStore & TutorStore;
  registry: Registry;
  now?: () => number;
}

const per100 = (askBacks: number, turns: number): number | undefined => (turns === 0 ? undefined : (askBacks / turns) * 100);
const bump = (counts: Record<string, number>, name: string): void => {
  counts[name] = (counts[name] ?? 0) + 1;
};
const positive = (value: number | undefined, fallback: number, what: string): number => {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new RangeError(`${what} must be a whole number of at least 1, not ${value}.`);
  return value;
};

export function createStats({ store, registry, now = Date.now, ...learn }: StatsOptions): Stats {
  const askBacks = positive(learn.askBacks, DEFAULT_ASK_BACKS, 'askBacks');
  const windowTurns = positive(learn.turns, DEFAULT_WINDOW_TURNS, 'turns');
  const core = registry.facts.filter((f) => f.core).map((f) => f.name);
  const isCore = new Set(core);
  // a name the list can hold: a fact the registry has, that is not read for every request anyway
  const listable = (name: string): boolean => registry.fact(name) !== undefined && !isCore.has(name);

  /** The record of `screen` from the start of its last `windowTurns` turns on (the turn line comes before its ask-backs). */
  const windowOf = (records: TutorRecord[]): TutorRecord[] => {
    let seen = 0;
    for (let at = records.length - 1; at >= 0; at--) {
      if (records[at].kind === 'turn' && ++seen === windowTurns) return records.slice(at);
    }
    return records;
  };

  const countsOf = (records: TutorRecord[]): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const r of records) if (r.kind === 'ask') bump(counts, r.name);
    return counts;
  };

  const lastWeights = (records: TutorRecord[]): { latest?: TutorRecord; before?: TutorRecord } => {
    const weights = records.filter((r) => r.kind === 'weights');
    return { latest: weights[weights.length - 1], before: weights[weights.length - 2] };
  };

  const rateOf = (records: TutorRecord[], since: number, until = Infinity): number | undefined => {
    let turns = 0;
    let asks = 0;
    for (const r of records) {
      if (r.at < since || r.at >= until) continue;
      if (r.kind === 'turn') turns++;
      else if (r.kind === 'ask') asks++;
    }
    return per100(asks, turns);
  };

  const changeOf = (records: TutorRecord[]): Change | undefined => {
    const { latest, before } = lastWeights(records);
    if (!latest) return undefined;
    return { at: latest.at, source: latest.name as WeightsSource, before: rateOf(records, before?.at ?? 0, latest.at), after: rateOf(records, latest.at) };
  };

  /** The extras of `screen`'s list: the applied or hand-set list, else the counted names (most asked back first). */
  async function extras(screen: string, records: TutorRecord[]): Promise<string[]> {
    const kept = await store.upFront(screen);
    if (kept.length > 0 || lastWeights(records).latest) return [...new Set(kept)].filter(listable);
    const counts = countsOf(windowOf(records));
    return Object.keys(counts)
      .filter((name) => counts[name] >= askBacks && listable(name))
      .sort((a, b) => counts[b] - counts[a]);
  }

  const upFront = async (screen: string): Promise<string[]> => [...core, ...(await extras(screen, await store.record(screen)))];

  const byScreen = (records: TutorRecord[]): Map<string, TutorRecord[]> => {
    const screens = new Map<string, TutorRecord[]>();
    for (const r of records) screens.set(r.screen, [...(screens.get(r.screen) ?? []), r]);
    return screens;
  };

  return {
    async stats(screen) {
      const out: Record<string, ScreenStats> = {};
      for (const [name, records] of byScreen(await store.record(screen))) {
        const entry: ScreenStats = { turns: 0, askBacks: {}, misses: {} };
        for (const r of records) {
          if (r.kind === 'turn') entry.turns++;
          else if (r.kind === 'ask') bump(entry.askBacks, r.name);
          else if (r.kind === 'miss') bump(entry.misses, r.name);
        }
        out[name] = entry;
      }
      return out;
    },

    upFront,

    async applyWeights(lists, from, at = now()) {
      const applied: Applied[] = [];
      for (const [screen, wanted] of Object.entries(lists)) {
        const names = [...new Set(wanted)].filter(listable);
        const ignored = [...new Set(wanted)].filter((name) => !listable(name));
        await store.setUpFront(screen, names);
        await store.note([{ at, screen, kind: 'weights', name: from, turn: 0, names }]);
        applied.push({ at, screen, source: from, names, ignored });
      }
      return applied;
    },

    async rate(screen, since, until) {
      return rateOf(await store.record(screen), since, until);
    },

    async change(screen) {
      return changeOf(await store.record(screen));
    },

    async weightsReport(since) {
      const records = await store.record();
      const screens: Record<string, ScreenReport> = {};
      for (const [screen, own] of byScreen(records)) {
        const inWindow = windowOf(own);
        const { latest } = lastWeights(own);
        const change = changeOf(own);
        screens[screen] = {
          turns: own.filter((r) => r.kind === 'turn').length,
          windowTurns: inWindow.filter((r) => r.kind === 'turn').length,
          counts: countsOf(inWindow),
          upFront: [...core, ...(await extras(screen, own))],
          ...(latest ? { applied: { at: latest.at, source: latest.name as WeightsSource, names: [...(latest.names ?? [])] } } : {}),
          rate: { overall: rateOf(own, 0), ...(change ? { before: change.before, after: change.after } : {}) },
        };
      }
      const misses: MissReport[] = [];
      for (const r of records) {
        if (r.kind !== 'miss' || r.at <= since) continue;
        const seen = misses.find((m) => m.screen === r.screen && m.name === r.name);
        if (seen) {
          seen.count++;
          seen.why = r.why ?? '';
        } else misses.push({ screen: r.screen, name: r.name, count: 1, why: r.why ?? '' });
      }
      const changed = records.some((r) => r.kind !== 'turn' && r.at > since);
      return { since, at: now(), changed, screens, misses };
    },
  };
}
