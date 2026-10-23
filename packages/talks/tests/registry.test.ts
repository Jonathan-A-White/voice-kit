import { describe, expect, it, vi } from 'vitest';
import { checkArgs, defineRegistry, type Command } from '../src/index.js';

const fact = (name: string, value: unknown = name) => ({ name, tell: `the ${name}`, read: async () => value });
const place = (name: string) => ({ name, tell: `opens ${name}`, open: async () => undefined });

describe('defineRegistry', () => {
  it('refuses a name used twice, across facts, commands and places', () => {
    const command: Command = { name: 'today', tell: 'x', kind: 'free', run: async () => ({ said: '' }) };
    expect(() => defineRegistry({ facts: [fact('today'), fact('today')] })).toThrow(/today/);
    expect(() => defineRegistry({ facts: [fact('today')], commands: [command] })).toThrow(/two .* are called "today"/);
    expect(() => defineRegistry({ facts: [fact('a')], places: [place('today')], commands: [command] })).toThrow(/today/);
    expect(() => defineRegistry({ facts: [fact('a')], places: [place('b')] })).not.toThrow();
  });

  it('lists every name with its tell line in the catalogue, sorted, the same every time', () => {
    const commands: Command[] = [
      { name: 'setTheme', tell: 'changes the theme', kind: 'undoable', args: { type: 'object', properties: { theme: { enum: ['dark', 'light'] } }, required: ['theme'] }, run: async () => ({ said: '' }) },
      { name: 'markDone', tell: 'marks the drill done', kind: 'free', run: async () => ({ said: '' }) },
    ];
    const one = defineRegistry({ facts: [fact('today'), { ...fact('plan'), core: true }], commands, places: [place('drill')] });
    const other = defineRegistry({ places: [place('drill')], commands: [...commands].reverse(), facts: [{ ...fact('plan'), core: true }, fact('today')] });
    expect(one.catalogue()).toEqual([
      { name: 'drill', is: 'place', tell: 'opens drill' },
      { name: 'markDone', is: 'command', kind: 'free', tell: 'marks the drill done' },
      { name: 'plan', is: 'fact', core: true, tell: 'the plan' },
      { name: 'setTheme', is: 'command', kind: 'undoable', tell: 'changes the theme', args: commands[0].args },
      { name: 'today', is: 'fact', tell: 'the today' },
    ]);
    expect(other.catalogue()).toEqual(one.catalogue());
    expect(JSON.stringify(one.catalogue())).toBe(JSON.stringify(one.catalogue()));
  });

  it('finds an entry by its name', () => {
    const registry = defineRegistry({ facts: [fact('today')], places: [place('drill')] });
    expect(registry.fact('today')?.tell).toBe('the today');
    expect(registry.place('drill')?.tell).toBe('opens drill');
    expect(registry.fact('drill')).toBeUndefined();
    expect(registry.command('today')).toBeUndefined();
  });
});

describe("a command's args", () => {
  const run = vi.fn(async (args: unknown) => ({ said: `Theme: ${(args as { theme: string }).theme}` }));
  const registry = defineRegistry({
    commands: [
      {
        name: 'setTheme',
        tell: 'changes the theme',
        kind: 'undoable',
        args: { type: 'object', properties: { theme: { type: 'string', enum: ['dark', 'light'] }, size: { type: 'integer', minimum: 10, maximum: 30 } }, required: ['theme'], additionalProperties: false },
        run,
      },
      { name: 'markDone', tell: 'marks the drill done', kind: 'free', run: async () => ({ said: 'Done.' }) },
    ],
  });

  it('are checked against its schema before it runs: a bad call is refused with the reason and run is never called', async () => {
    run.mockClear();
    const refused = async (name: string, args: unknown) => {
      const outcome = await registry.run(name, args);
      expect(outcome.ok, JSON.stringify(args)).toBe(false);
      return outcome.ok ? '' : outcome.why;
    };
    expect(await refused('setTheme', {})).toMatch(/theme is required/);
    expect(await refused('setTheme', { theme: 'pink' })).toMatch(/theme must be one of "dark", "light"/);
    expect(await refused('setTheme', { theme: 3 })).toMatch(/theme must be a string/);
    expect(await refused('setTheme', { theme: 'dark', size: 9 })).toMatch(/size must be at least 10/);
    expect(await refused('setTheme', { theme: 'dark', size: 12.5 })).toMatch(/size must be an integer/);
    expect(await refused('setTheme', { theme: 'dark', colour: 'red' })).toMatch(/colour is not an arg it takes/);
    expect(await refused('setTheme', 'dark')).toMatch(/must be an object/);
    expect(await refused('markDone', { now: true })).toMatch(/takes no args/);
    expect(await refused('fly', {})).toMatch(/no command called "fly"/);
    expect(run).not.toHaveBeenCalled();
  });

  it('a good call runs and says what it did', async () => {
    run.mockClear();
    expect(await registry.run('setTheme', { theme: 'dark', size: 12 })).toEqual({ ok: true, said: 'Theme: dark' });
    expect(run).toHaveBeenCalledWith({ theme: 'dark', size: 12 });
    expect(await registry.run('markDone', undefined)).toEqual({ ok: true, said: 'Done.' });
  });

  it('a command that throws is refused with what it said, not thrown', async () => {
    const broken = defineRegistry({ commands: [{ name: 'save', tell: 'saves', kind: 'free', run: async () => Promise.reject(new Error('disk full')) }] });
    expect(await broken.run('save', {})).toEqual({ ok: false, why: 'save failed: disk full' });
  });

  it('checkArgs reads arrays and nested objects', () => {
    const schema = { type: 'object' as const, properties: { days: { type: 'array' as const, items: { type: 'number' as const } }, at: { type: 'object' as const, properties: { book: { type: 'string' as const, minLength: 1 } }, required: ['book'] } } };
    expect(checkArgs(schema, { days: [1, 2], at: { book: 'John' } })).toBeUndefined();
    expect(checkArgs(schema, { days: [1, 'two'] })).toMatch(/days\[1\] must be a number/);
    expect(checkArgs(schema, { at: {} })).toMatch(/at\.book is required/);
    expect(checkArgs(schema, { at: { book: '' } })).toMatch(/at\.book must be at least 1 character/);
  });
});

describe('places', () => {
  it('open with checked args; an unknown place or bad args are refused, open never called', async () => {
    const open = vi.fn(async () => undefined);
    const registry = defineRegistry({ places: [{ name: 'chapter', tell: 'opens a chapter', args: { type: 'object', properties: { chapter: { type: 'integer' } }, required: ['chapter'] }, open }] });
    expect(await registry.open('chapter', {})).toEqual({ ok: false, why: 'args.chapter is required' });
    expect(await registry.open('nowhere', {})).toEqual({ ok: false, why: 'there is no place called "nowhere"' });
    expect(open).not.toHaveBeenCalled();
    expect(await registry.open('chapter', { chapter: 3 })).toEqual({ ok: true });
    expect(open).toHaveBeenCalledWith({ chapter: 3 });
  });
});
