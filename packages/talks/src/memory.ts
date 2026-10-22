// memory.ts (mw-79en7t.30) — what a talk remembers beyond the last few turns: facts kept and a rolling summary, folded into each
// request the grind gets. Carved from Lampas's src/talk/memoryUpdate.ts and src/data/repositories/memory.ts with the Bible parts
// (book:/word:/topic: names, the Greek offer, the index) left behind. The memory of a talk is the `TalkMemory` its store keeps with
// it ({ facts, summary }), so a delete takes it too. The grind fills it: an answer may carry a `memory_update`
// ({ add?, remove?, summary? }), which is applied here by rules the app does not have to repeat, and the app may do the same by hand
// (`talks.remember`). Nothing here is read as meaning anything: a fact is a short line of words, the summary is one text the grind
// rewrites as the talk goes on.
import type { TalkMemory } from './store.js';

/** The most facts a talk keeps. */
export const MEMORY_MAX_FACTS = 40;
/** The longest a fact is, in characters. */
export const MEMORY_FACT_MAX_CHARS = 300;
/** The longest the summary is, in characters. */
export const MEMORY_SUMMARY_MAX_CHARS = 1500;

/** What an answer (or the app) changes in a talk's memory. Every part is optional. */
export interface MemoryUpdate {
  /** Facts to keep, each a short line (trimmed; one already kept, or an empty one, is refused). */
  add?: string[];
  /** Facts to forget, matched whole, ignoring case and the space around (one not kept is refused). */
  remove?: string[];
  /** The summary of the talk so far, replacing the one kept (cut when too long). */
  summary?: string;
}

export interface MemoryLimits {
  maxFacts?: number;
  maxFactChars?: number;
  maxSummaryChars?: number;
}

export interface MemoryChange {
  /** The memory after the update. */
  memory: TalkMemory;
  /** What was done, one line each ('Added: likes Greek'). */
  applied: string[];
  /** What was refused and why, one line each. */
  refused: string[];
}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

/** Whether `value` is a MemoryUpdate: only `add`, `remove` (lists of text) and `summary` (text). */
export function isMemoryUpdate(value: unknown): value is MemoryUpdate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const update = value as Record<string, unknown>;
  if (Object.keys(update).some((k) => k !== 'add' && k !== 'remove' && k !== 'summary')) return false;
  if ('add' in update && update.add !== undefined && !isStrings(update.add)) return false;
  if ('remove' in update && update.remove !== undefined && !isStrings(update.remove)) return false;
  return !('summary' in update && update.summary !== undefined && typeof update.summary !== 'string');
}

/** The `memory_update` of an answer that is an object carrying a valid one; otherwise undefined (a plain answer, or a malformed update, changes nothing). */
export function readMemoryUpdate(answer: unknown): MemoryUpdate | undefined {
  if (typeof answer !== 'object' || answer === null) return undefined;
  const update = (answer as { memory_update?: unknown }).memory_update;
  return isMemoryUpdate(update) ? update : undefined;
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Whether the memory holds nothing. */
export const isMemoryEmpty = (memory: TalkMemory): boolean => memory.facts.length === 0 && memory.summary === '';

/** Applies `update` to `memory` without changing it: removes first, then adds in order, then the summary. A line it cannot keep is refused, never thrown. */
export function applyMemoryUpdate(memory: TalkMemory, update: MemoryUpdate, limits: MemoryLimits = {}): MemoryChange {
  const { maxFacts = MEMORY_MAX_FACTS, maxFactChars = MEMORY_FACT_MAX_CHARS, maxSummaryChars = MEMORY_SUMMARY_MAX_CHARS } = limits;
  const facts = [...memory.facts];
  let summary = memory.summary;
  const applied: string[] = [];
  const refused: string[] = [];
  for (const raw of update.remove ?? []) {
    const at = facts.findIndex((f) => same(f, raw.trim()));
    if (at < 0) {
      refused.push(`Did not remove ${JSON.stringify(raw)}: not kept`);
      continue;
    }
    applied.push(`Removed: ${facts[at]}`);
    facts.splice(at, 1);
  }
  for (const raw of update.add ?? []) {
    const fact = raw.trim();
    const no = (why: string): number => refused.push(`Did not add ${JSON.stringify(raw)}: ${why}`);
    if (fact === '') no('empty');
    else if (fact.length > maxFactChars) no(`longer than ${maxFactChars} characters`);
    else if (facts.some((f) => same(f, fact))) no('already kept');
    else if (facts.length >= maxFacts) no(`${maxFacts} facts are kept already`);
    else {
      facts.push(fact);
      applied.push(`Added: ${fact}`);
    }
  }
  if (update.summary !== undefined) {
    let next = update.summary.trim();
    if (next.length > maxSummaryChars) next = next.slice(0, maxSummaryChars - 1).trimEnd() + '…';
    if (next !== summary) {
      summary = next;
      applied.push('Summary changed');
    }
  }
  return { memory: { facts, summary }, applied, refused };
}
