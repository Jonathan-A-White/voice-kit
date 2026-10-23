// The form as the tutor sees it (mw-o7cts8.1): what the request carries of a form, which fields an answer may fill, when the form
// may be sent, and the tutor asking one question. Lifted from Lampas's formHelper tests, with the choice kind added.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyValues, FORM_FIELD_MAX, FORM_START, FORM_VALUE_MAX, MAX_FORM_FIELDS, oneQuestion, requestFields, requiredFilled, type FormSpec } from '../src/index.js';

const book: FormSpec = {
  name: 'Ask for a book',
  fields: [
    { name: 'author', label: 'Author', required: true, kind: 'text', maxLength: 120 },
    { name: 'title', label: 'Title', hint: 'Required: as on the cover.', required: true, kind: 'text' },
    { name: 'format', label: 'Format', required: false, kind: 'choice', options: ['Paperback', 'Hardback', 'E-book'] },
    { name: 'cover', label: 'Add a photo of the cover', required: false, kind: 'pictures' },
    { name: 'link', label: 'Link', required: false, kind: 'link' },
  ],
};

describe('requestFields', () => {
  it('gives each field: name, label, hint, required, kind and value, in screen order', () => {
    expect(requestFields(book, { author: 'Wallace', title: 'Greek Grammar Beyond the Basics', format: 'Hardback' })).toEqual([
      { name: 'author', label: 'Author', required: true, kind: 'text', value: 'Wallace' },
      { name: 'title', label: 'Title', hint: 'Required: as on the cover.', required: true, kind: 'text', value: 'Greek Grammar Beyond the Basics' },
      { name: 'format', label: 'Format', required: false, kind: 'choice', value: 'Hardback', options: ['Paperback', 'Hardback', 'E-book'] },
      { name: 'cover', label: 'Add a photo of the cover', required: false, kind: 'pictures', value: '' },
      { name: 'link', label: 'Link', required: false, kind: 'link', value: '' },
    ]);
  });

  it('cuts a label at 80, a hint at 120 and a value at 600', () => {
    const form: FormSpec = { name: 'F', fields: [{ name: 'a', label: 'l'.repeat(200), hint: 'h'.repeat(200), required: false, kind: 'text' }] };
    const [field] = requestFields(form, { a: 'v'.repeat(1200) });
    expect(field.label.length).toBe(80);
    expect(field.hint?.length).toBe(120);
    expect(field.value.length).toBe(FORM_FIELD_MAX);
    expect(FORM_FIELD_MAX).toBe(600);
  });

  it('gives at most 8 fields', () => {
    const fields = Array.from({ length: 12 }, (_, i) => ({ name: `f${i}`, label: `F ${i}`, required: false, kind: 'text' as const }));
    expect(MAX_FORM_FIELDS).toBe(8);
    expect(requestFields({ name: 'Long', fields }, {}).map((f) => f.name)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7']);
  });

  it('has no options on a field that is not a choice, and a missing value is empty', () => {
    const [author] = requestFields(book, {});
    expect('options' in author).toBe(false);
    expect(author.value).toBe('');
  });
});

describe('applyValues', () => {
  it('fills the fields the form has, trimmed', () => {
    expect(applyValues(book, [{ field: 'author', value: '  Wallace  ' }, { field: 'title', value: 'Greek' }])).toEqual([
      { field: 'author', value: 'Wallace' },
      { field: 'title', value: 'Greek' },
    ]);
  });

  it('ignores a field the form does not have, and a pictures field, which only he can fill', () => {
    expect(applyValues(book, [{ field: 'send', value: 'now' }, { field: 'cover', value: '3' }, { field: 'link', value: 'example.org' }])).toEqual([{ field: 'link', value: 'example.org' }]);
  });

  it('cuts a value to the field limit, or 1,200 when the field has none', () => {
    const [author, title] = applyValues(book, [{ field: 'author', value: 'a'.repeat(500) }, { field: 'title', value: 't'.repeat(2000) }]);
    expect(author.value.length).toBe(120);
    expect(title.value.length).toBe(FORM_VALUE_MAX);
    expect(FORM_VALUE_MAX).toBe(1200);
  });

  it('ignores an empty value, and no values at all', () => {
    expect(applyValues(book, [{ field: 'author', value: '   ' }, { field: 'title', value: '' }])).toEqual([]);
    expect(applyValues(book, undefined)).toEqual([]);
  });

  it('takes a choice value that is one of the options, and ignores one that is not', () => {
    expect(applyValues(book, [{ field: 'format', value: ' Hardback ' }])).toEqual([{ field: 'format', value: 'Hardback' }]);
    expect(applyValues(book, [{ field: 'format', value: 'hardback' }, { field: 'format', value: 'Scroll' }])).toEqual([]);
  });
});

describe('requiredFilled', () => {
  it('is true only when every required field holds a non-blank value', () => {
    expect(requiredFilled(book, { author: 'Wallace', title: 'Greek' })).toBe(true);
    expect(requiredFilled(book, { author: 'Wallace' })).toBe(false);
    expect(requiredFilled(book, { author: 'Wallace', title: '   ' })).toBe(false);
    expect(requiredFilled(book, {})).toBe(false);
  });

  it('does not ask for an optional field, and a form with none required is filled', () => {
    expect(requiredFilled({ name: 'F', fields: [{ name: 'a', label: 'A', required: false, kind: 'text' }] }, {})).toBe(true);
  });
});

describe('oneQuestion', () => {
  it('stops at the first question mark followed by a space or the end', () => {
    expect(oneQuestion('Q? More text.')).toBe('Q?');
    expect(oneQuestion("Who made this approach, so we can credit them? If it's the Greek Colour Method…")).toBe('Who made this approach, so we can credit them?');
    expect(oneQuestion('Who made it? Is it Anna? Or someone else?')).toBe('Who made it?');
    expect(oneQuestion('Who made it?')).toBe('Who made it?');
  });

  it('leaves a question mark inside an address, and an answer with no question, as they are', () => {
    expect(oneQuestion('Is it at example.org/a?b=1 or elsewhere? Tell me.')).toBe('Is it at example.org/a?b=1 or elsewhere?');
    expect(oneQuestion('example.org/a?b=1')).toBe('example.org/a?b=1');
    expect(oneQuestion('That is everything I need. Read it, then tap Send yourself.')).toBe('That is everything I need. Read it, then tap Send yourself.');
    expect(oneQuestion('')).toBe('');
  });
});

describe('FORM_START', () => {
  it('is what he says first, when he taps the button', () => {
    expect(FORM_START).toBe('Help me fill this in.');
  });
});

describe('the grind fragment', () => {
  const grind = readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'grind', 'helping-with-a-form.md'), 'utf-8');

  it('is under 3,000 bytes', () => {
    expect(new TextEncoder().encode(grind).length).toBeLessThan(3000);
  });

  it('names the choice rule, the Send-button rule and that the tutor never sends', () => {
    expect(grind).toContain('one of its `options`, exactly');
    expect(grind).toContain('shows a Send button');
    expect(grind).toContain('Never send the form');
  });
});
