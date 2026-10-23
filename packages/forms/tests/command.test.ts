// formCommand (mw-o7cts8.1): the Command a form adds to the app's registry, so the form's own Send button and the tutor's `do` are one path.
import { describe, expect, it, vi } from 'vitest';
import { defineRegistry } from 'voice-kit/talks';
import { argsOf, formCommand, type FormSpec } from '../src/index.js';

const book: FormSpec = {
  name: 'Ask for a book',
  fields: [
    { name: 'author', label: 'Author', required: true, kind: 'text', maxLength: 120 },
    { name: 'title', label: 'Title', required: true, kind: 'text' },
    { name: 'format', label: 'Format', required: false, kind: 'choice', options: ['Paperback', 'Hardback'] },
    { name: 'cover', label: 'Add a photo of the cover', required: false, kind: 'pictures' },
    { name: 'link', label: 'Link', required: false, kind: 'link', maxLength: 300 },
  ],
};

const make = (send = vi.fn(async () => ({ said: 'Asked for the book.' })), extra: Partial<Parameters<typeof formCommand>[1]> = {}) => {
  const command = formCommand(book, { name: 'askForBook', tell: 'Sends the Ask for a book form', send, ...extra });
  return { command, send, registry: defineRegistry({ commands: [command] }) };
};

describe('formCommand', () => {
  it('builds an args schema with one string property per field he types into', () => {
    const { command } = make();
    expect(command.name).toBe('askForBook');
    expect(command.tell).toBe('Sends the Ask for a book form');
    expect(command.args?.type).toBe('object');
    expect(Object.keys(command.args?.properties ?? {})).toEqual(['author', 'title', 'format', 'link']);
    for (const property of Object.values(command.args?.properties ?? {})) expect(property.type).toBe('string');
    expect(command.args?.properties?.author.maxLength).toBe(120);
    expect(command.args?.properties?.link.maxLength).toBe(300);
    expect(command.args?.properties?.format.enum).toEqual(['Paperback', 'Hardback']);
    expect(command.args?.required).toEqual(['author', 'title']);
    expect(command.args?.additionalProperties).toBe(false);
  });

  it('is a confirm command unless given a kind', () => {
    expect(make().command.kind).toBe('confirm');
    expect(make(undefined, { kind: 'undoable' }).command.kind).toBe('undoable');
    expect(make(undefined, { kind: 'free' }).command.kind).toBe('free');
  });

  it('shows in the registry catalogue with its args', () => {
    const entry = make().registry.catalogue().find((e) => e.name === 'askForBook');
    expect(entry).toMatchObject({ is: 'command', kind: 'confirm' });
    expect(entry?.args?.required).toEqual(['author', 'title']);
  });
});

describe('argsOf', () => {
  it('gives the args the form\'s own Send passes: the typed fields with something in them, trimmed', () => {
    expect(argsOf(book, { author: ' Wallace ', title: 'Greek', format: '', link: '   ', cover: '2 pictures added', other: 'x' })).toEqual({ author: 'Wallace', title: 'Greek' });
    expect(argsOf(book, {})).toEqual({});
  });
});

describe('the registry over a form command', () => {
  it('does not refuse a filled form', () => {
    const { registry } = make();
    expect(registry.refuses('askForBook', argsOf(book, { author: 'Wallace', title: 'Greek', format: 'Hardback' }))).toBeUndefined();
  });

  it('refuses a missing required field, naming it', () => {
    const { registry } = make();
    expect(registry.refuses('askForBook', argsOf(book, { author: 'Wallace' }))).toContain('title');
    expect(registry.refuses('askForBook', argsOf(book, { title: 'Greek', author: '  ' }))).toContain('author');
  });

  it('refuses an over-long value, naming the field', () => {
    const { registry } = make();
    const why = registry.refuses('askForBook', argsOf(book, { author: 'a'.repeat(121), title: 'Greek' }));
    expect(why).toContain('author');
    expect(why).toContain('120');
  });

  it('refuses a choice that is not among the options, naming the field', () => {
    const { registry } = make();
    const why = registry.refuses('askForBook', argsOf(book, { author: 'Wallace', title: 'Greek', format: 'Scroll' }));
    expect(why).toContain('format');
    expect(why).toContain('Paperback');
  });

  it('refuses a field the form does not have, and a pictures field', () => {
    const { registry } = make();
    expect(registry.refuses('askForBook', { author: 'W', title: 'G', cover: '1' })).toContain('cover');
    expect(registry.refuses('askForBook', { author: 'W', title: 'G', send: 'now' })).toContain('send');
  });

  it('runs good args once through send, with those values, and returns its said line', async () => {
    const { registry, send } = make();
    const ran = await registry.run('askForBook', argsOf(book, { author: 'Wallace', title: 'Greek', format: 'Paperback' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ author: 'Wallace', title: 'Greek', format: 'Paperback' });
    expect(ran).toEqual({ ok: true, said: 'Asked for the book.' });
  });

  it('never runs send for refused args', async () => {
    const { registry, send } = make();
    const ran = await registry.run('askForBook', { author: 'Wallace' });
    expect(ran.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('hands on the undo that send gives', async () => {
    const undo = vi.fn(async () => undefined);
    const { registry } = make(vi.fn(async () => ({ said: 'Done.', undo })), { kind: 'undoable' });
    const ran = await registry.run('askForBook', { author: 'W', title: 'G' });
    expect(ran).toMatchObject({ ok: true, said: 'Done.', undo });
  });
});

describe('the offer', () => {
  it('names the form and the required values by default', () => {
    const { command } = make();
    expect(command.offer?.({ author: 'Wallace', title: 'Greek Grammar Beyond the Basics', format: 'Hardback' })).toBe('Send Ask for a book: Wallace, Greek Grammar Beyond the Basics?');
  });

  it('is the app\'s own line when given', () => {
    const { command } = make(undefined, { offer: (values) => `Ask for ${values.title}?` });
    expect(command.offer?.({ author: 'W', title: 'Greek' })).toBe('Ask for Greek?');
  });
});
