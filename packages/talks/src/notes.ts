// notes.ts (mw-o480n1.2) — notes an app keeps by name, beside the per-talk memory of memory.ts. A talk's memory is facts and a summary
// that live with the talk; an app whose memory is NAMED NOTES kept app-wide (a note for a book, one for a word, an index) keeps them in
// its own store and plugs in here. The grind answers with a `memory_update` list of `NoteUpdate`s; `applyNoteUpdates` holds the rules
// the app does not have to repeat: an append goes through, a replace or remove only when the grind says it was `directed` (the user's
// own words in this talk asked for it), a name outside the app's scheme is refused, and a write that fails or throws is refused, never
// thrown. The app gives a `NoteStore` that knows its names and writes its notes.

/** One change to one named note: exactly one of `append`, `replace` and `remove`. */
export interface NoteUpdate {
  /** The note's name, as the grind wrote it (the app's `nameOf` says whether it is one). */
  name: string;
  /** Text to add to the note. */
  append?: string;
  /** The note's whole new text. Applied only with `directed`. */
  replace?: string;
  /** Forget the note. Applied only with `directed`. */
  remove?: true;
  /** The grind says the user's own words in this talk asked for the replace or remove. Never with an append. */
  directed?: true;
}

export interface NoteLimits {
  /** The longest a name is, in characters. */
  nameMax: number;
  /** The longest an `append` is, in characters. */
  appendMax: number;
  /** The longest a `replace` is, in characters. */
  replaceMax: number;
}

/** What a write answers: 'saved', or any other string, the reason it was not. */
export type NoteWrite = 'saved' | (string & {});

/** The app's notes. Each write answers 'saved' or the reason it did not; a throw is read as a refusal too. */
export interface NoteStore {
  /** The name in the app's scheme that `raw` stands for, or null when it is not one. The line and the writes use this name. */
  nameOf(raw: string): string | null;
  append(name: string, text: string, when: number): Promise<NoteWrite>;
  replace(name: string, text: string, when: number): Promise<NoteWrite>;
  remove(name: string, when: number): Promise<NoteWrite>;
}

export interface NotesChange {
  /** What was done, one line each ('Added to topic:grace', 'Replaced book:Romans', 'Removed topic:grace'). */
  applied: string[];
  /** What was refused and why, one line each ('Did not change topic:grace: too-long'). */
  refused: string[];
}

export interface NoteOptions {
  /** The time given to every write; the time now when absent. */
  when?: number;
  /** Given each refused line (to log it); a throw from it is ignored. */
  warn?: (line: string) => void;
}

const KEYS = new Set(['name', 'append', 'replace', 'remove', 'directed']);

const isText = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim() !== '' && value.length <= max;

/** Whether `value` is a NoteUpdate within `limits`: a name, exactly one of append, replace and remove, `directed` only as true and only with a replace or remove, no other key, each text non-empty and within its limit. */
export function isNoteUpdate(value: unknown, limits: NoteLimits): value is NoteUpdate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const update = value as Record<string, unknown>;
  if (Object.keys(update).some((k) => !KEYS.has(k))) return false;
  if (!isText(update.name, limits.nameMax)) return false;
  const has = (k: string): boolean => k in update && update[k] !== undefined;
  const actions = ['append', 'replace', 'remove'].filter(has);
  if (actions.length !== 1) return false;
  if (has('directed') && (update.directed !== true || has('append'))) return false;
  if (has('append')) return isText(update.append, limits.appendMax);
  if (has('replace')) return isText(update.replace, limits.replaceMax);
  return update.remove === true;
}

/** The `memory_update` of an answer that is an object whose `memory_update` is a list of valid NoteUpdates; otherwise undefined (one bad entry makes it all undefined, so a half-read update is never applied). */
export function readNoteUpdates(answer: unknown, limits: NoteLimits): NoteUpdate[] | undefined {
  if (typeof answer !== 'object' || answer === null) return undefined;
  const list = (answer as { memory_update?: unknown }).memory_update;
  if (!Array.isArray(list) || !list.every((u) => isNoteUpdate(u, limits))) return undefined;
  return list as NoteUpdate[];
}

const messageOf = (error: unknown): string => (error instanceof Error && error.message !== '' ? error.message : 'could not be written');

/** Applies `updates` to `notes` in order. A refused update is a line in `refused` (and given to `warn`); nothing is thrown, and the next update still runs. */
export async function applyNoteUpdates(updates: readonly NoteUpdate[], notes: NoteStore, options: NoteOptions = {}): Promise<NotesChange> {
  const when = options.when ?? Date.now();
  const applied: string[] = [];
  const refused: string[] = [];
  for (const update of updates) {
    let name = update.name;
    const no = (why: string): void => {
      const line = `Did not change ${name}: ${why}`;
      refused.push(line);
      try {
        options.warn?.(line);
      } catch {
        // a logger that throws must not stop the notes
      }
    };
    try {
      const known = notes.nameOf(update.name);
      if (known === null) {
        no('not a name in the scheme');
        continue;
      }
      name = known;
      let done: string;
      let result: NoteWrite;
      if (update.append !== undefined) {
        done = `Added to ${name}`;
        result = await notes.append(name, update.append, when);
      } else if (update.directed !== true) {
        no('a replace or remove needs his words in this talk');
        continue;
      } else if (update.replace !== undefined) {
        done = `Replaced ${name}`;
        result = await notes.replace(name, update.replace, when);
      } else {
        done = `Removed ${name}`;
        result = await notes.remove(name, when);
      }
      if (result === 'saved') applied.push(done);
      else no(result);
    } catch (error) {
      no(messageOf(error));
    }
  }
  return { applied, refused };
}
