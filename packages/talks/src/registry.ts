// registry.ts (mw-t3xu9a.1) — what an app lets its tutor know, do and open, by name. The Governor's word: anything you do in the
// app, the tutor can ask the app to do, and anything the app knows, the tutor can ask for. An app lists its facts (named reads),
// commands (named actions with a small JSON schema for their args, and whether they run at once, run with an undo, or wait for
// him to confirm) and places (named screens it can open); the tutor client (tutorClient.ts) sends the catalogue of them and
// carries out what an answer asks. A call is checked against the list before anything runs, as pwa-kit's settings registry
// checks a change: a name the app does not have, or args its schema does not allow, is refused with the reason and never run.

/** The small part of JSON Schema a command's or a place's args are checked against. */
export interface ArgsSchema {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  /** For an object: its args by name. */
  properties?: Record<string, ArgsSchema>;
  /** For an object: the args that must be there. */
  required?: string[];
  /** For an object: false refuses an arg `properties` does not name. */
  additionalProperties?: boolean;
  /** For an array: what each item is. */
  items?: ArgsSchema;
  /** The only values allowed. */
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  /** For the tutor: what the arg means. Not checked. */
  description?: string;
}

/** Something the app knows, read when the tutor needs it. */
export interface Fact {
  name: string;
  /** One line for the tutor: what it holds. */
  tell: string;
  read(): Promise<unknown>;
  /** Read for every request, whatever the screen. */
  core?: boolean;
}

/** 'free' runs at once; 'undoable' runs and hands the app its undo; 'confirm' waits until the app calls confirm(). */
export type CommandKind = 'free' | 'undoable' | 'confirm';

/** What a command did: the line the app shows or says, and for an undoable command the way back. */
export interface CommandResult {
  said: string;
  undo?: () => Promise<void>;
}

/** Something the app does when the tutor asks. */
export interface Command {
  name: string;
  /** One line for the tutor: what it does. */
  tell: string;
  /** The args it takes; without a schema it takes none. */
  args?: ArgsSchema;
  kind: CommandKind;
  /** For a confirm command: the question the app puts to him before it runs (checked args in); the tell line unless given. */
  offer?: (args: unknown) => string;
  run(args: unknown): Promise<CommandResult>;
}

/** A screen, sheet or spot the app can open when the tutor asks. */
export interface Place {
  name: string;
  /** One line for the tutor: what is there. */
  tell: string;
  /** The args it takes (which chapter, which word); without a schema it takes none. */
  args?: ArgsSchema;
  open(args: unknown): Promise<void>;
}

/** One line of the catalogue the tutor is sent: a name, what it is, and its tell line (cut when the request is too big). */
export interface CatalogueEntry {
  name: string;
  is: 'fact' | 'command' | 'place';
  /** A command's kind. */
  kind?: CommandKind;
  /** A core fact: always in the request's facts. */
  core?: true;
  tell?: string;
  args?: ArgsSchema;
}

export type Ran = ({ ok: true } & CommandResult) | { ok: false; why: string };
export type Opened = { ok: true } | { ok: false; why: string };
export type Read = { ok: true; value: unknown } | { ok: false; why: string };

export interface Registry {
  readonly facts: readonly Fact[];
  readonly commands: readonly Command[];
  readonly places: readonly Place[];
  fact(name: string): Fact | undefined;
  command(name: string): Command | undefined;
  place(name: string): Place | undefined;
  /** Every name with what it is and its tell line, sorted by name: the same list every time. */
  catalogue(): CatalogueEntry[];
  /** Why a call of this command or place would be refused (no such name, args its schema does not allow); undefined when it would not. */
  refuses(name: string, args: unknown): string | undefined;
  /** Checks the call and runs the command; a refused call never runs, and a run that throws is refused with what it said. */
  run(name: string, args: unknown): Promise<Ran>;
  /** Checks the call and opens the place, as `run`. */
  open(name: string, args: unknown): Promise<Opened>;
  /** Reads a fact; a name that is no fact, or a read that throws, is refused with the reason. */
  read(name: string): Promise<Read>;
}

const quoted = (value: unknown): string => JSON.stringify(value) ?? String(value);
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const TYPE_WORDS: Record<NonNullable<ArgsSchema['type']>, string> = {
  object: 'an object',
  array: 'an array',
  string: 'a string',
  number: 'a number',
  integer: 'an integer',
  boolean: 'true or false',
  null: 'null',
};

function isType(type: NonNullable<ArgsSchema['type']>, value: unknown): boolean {
  switch (type) {
    case 'object':
      return isObject(value);
    case 'array':
      return Array.isArray(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'null':
      return value === null;
    default:
      return typeof value === type;
  }
}

/** Checks `value` against `schema`; the first thing wrong, in words ('args.theme must be one of "dark", "light"'), or undefined. */
export function checkArgs(schema: ArgsSchema, value: unknown, path = 'args'): string | undefined {
  if (schema.type && !isType(schema.type, value)) return `${path} must be ${TYPE_WORDS[schema.type]}`;
  if (schema.enum && !schema.enum.some((allowed) => allowed === value)) return `${path} must be one of ${schema.enum.map(quoted).join(', ')}`;
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return `${path} must be at least ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${path} must be at most ${schema.maximum}`;
  }
  if (typeof value === 'string') {
    const chars = (n: number): string => `${n} character${n === 1 ? '' : 's'}`;
    if (schema.minLength !== undefined && value.length < schema.minLength) return `${path} must be at least ${chars(schema.minLength)}`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} must be at most ${chars(schema.maxLength)}`;
  }
  if (Array.isArray(value) && schema.items) {
    for (const [index, item] of value.entries()) {
      const wrong = checkArgs(schema.items, item, `${path}[${index}]`);
      if (wrong) return wrong;
    }
  }
  if (isObject(value) && (schema.properties || schema.required)) {
    for (const key of schema.required ?? []) if (!(key in value)) return `${path}.${key} is required`;
    for (const [key, item] of Object.entries(value)) {
      const property = schema.properties?.[key];
      if (property) {
        const wrong = checkArgs(property, item, `${path}.${key}`);
        if (wrong) return wrong;
      } else if (schema.additionalProperties === false) return `${path}.${key} is not an arg it takes`;
    }
  }
  return undefined;
}

/** The args a call runs with: as given against a schema ({} when none were given), else none. */
const argsOf = (schema: ArgsSchema | undefined, args: unknown): unknown => (args === undefined ? {} : schema ? args : {});
const noArgs = (args: unknown): boolean => args === undefined || (isObject(args) && Object.keys(args).length === 0);

export interface RegistryInit {
  facts?: readonly Fact[];
  commands?: readonly Command[];
  places?: readonly Place[];
}

/** The app's registry. Throws when two of its facts, commands and places share a name: a name is the one way the tutor has to call one. */
export function defineRegistry({ facts = [], commands = [], places = [] }: RegistryInit): Registry {
  const kinds = new Map<string, CatalogueEntry['is']>();
  for (const [is, list] of [['fact', facts], ['command', commands], ['place', places]] as const) {
    for (const { name } of list) {
      const before = kinds.get(name);
      if (before) throw new Error(`two of the registry's facts, commands and places are called ${quoted(name)} (a ${before} and a ${is})`);
      kinds.set(name, is);
    }
  }
  const byName = <T extends { name: string }>(list: readonly T[]): Map<string, T> => new Map(list.map((entry) => [entry.name, entry]));
  const factsByName = byName(facts);
  const commandsByName = byName(commands);
  const placesByName = byName(places);

  const entries: CatalogueEntry[] = [
    ...facts.map((f): CatalogueEntry => ({ name: f.name, is: 'fact', ...(f.core ? { core: true as const } : {}), tell: f.tell })),
    ...commands.map((c): CatalogueEntry => ({ name: c.name, is: 'command', kind: c.kind, tell: c.tell, ...(c.args ? { args: c.args } : {}) })),
    ...places.map((p): CatalogueEntry => ({ name: p.name, is: 'place', tell: p.tell, ...(p.args ? { args: p.args } : {}) })),
  ].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const refuses = (name: string, args: unknown): string | undefined => {
    const target = commandsByName.get(name) ?? placesByName.get(name);
    if (!target) return `there is no command or place called ${quoted(name)}`;
    if (!target.args) return noArgs(args) ? undefined : `${name} takes no args`;
    return checkArgs(target.args, argsOf(target.args, args));
  };

  return {
    facts,
    commands,
    places,
    fact: (name) => factsByName.get(name),
    command: (name) => commandsByName.get(name),
    place: (name) => placesByName.get(name),
    catalogue: () => entries.map((entry) => ({ ...entry })),
    refuses,
    async run(name, args) {
      const command = commandsByName.get(name);
      if (!command) return { ok: false, why: `there is no command called ${quoted(name)}` };
      const why = refuses(name, args);
      if (why) return { ok: false, why };
      try {
        return { ok: true, ...(await command.run(argsOf(command.args, args))) };
      } catch (error) {
        return { ok: false, why: `${name} failed: ${reason(error)}` };
      }
    },
    async open(name, args) {
      const place = placesByName.get(name);
      if (!place) return { ok: false, why: `there is no place called ${quoted(name)}` };
      const why = refuses(name, args);
      if (why) return { ok: false, why };
      try {
        await place.open(argsOf(place.args, args));
        return { ok: true };
      } catch (error) {
        return { ok: false, why: `${name} could not be opened: ${reason(error)}` };
      }
    },
    async read(name) {
      const fact = factsByName.get(name);
      if (!fact) return { ok: false, why: `there is no fact called ${quoted(name)}` };
      try {
        return { ok: true, value: await fact.read() };
      } catch (error) {
        return { ok: false, why: `${name} could not be read: ${reason(error)}` };
      }
    },
  };
}
