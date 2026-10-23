// @vitest-environment node
// The grind side of the tutor client (mw-t3xu9a.3): the words an app's grind includes to teach the tutor protocol, and the schema
// fragment its answer merges in. Imported under node: the module has no browser-only import.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { answerExamples, answerFragment, instructionsPart, INSTRUCTIONS_MAX_BYTES } from '../src/grind.js';
import { checkArgs, createMemoryStore, createTutorClient, defineRegistry, type ArgsSchema } from '../src/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bytes = (text: string): number => new TextEncoder().encode(text).length;
const valid = (answer: unknown): string | undefined => checkArgs(answerFragment as ArgsSchema, answer);

describe('instructionsPart', () => {
  it('is under 6,000 bytes', () => {
    expect(INSTRUCTIONS_MAX_BYTES).toBe(6000);
    expect(bytes(instructionsPart)).toBeLessThan(6000);
  });

  it('names asks, do, go, misses, said and the catalogue', () => {
    for (const word of ['asks', 'do', 'go', 'misses', 'said', 'catalogue']) {
      expect(instructionsPart, word).toMatch(new RegExp(`\\b${word}\\b`));
    }
  });

  it('teaches the three kinds of command and that nothing outside the catalogue is named', () => {
    for (const kind of ['free', 'undoable', 'confirm']) expect(instructionsPart, kind).toContain(kind);
    expect(instructionsPart).toMatch(/never put a name that is not on the catalogue/);
  });

  it('is the same text as grind/instructions.md', () => {
    expect(readFileSync(join(root, 'grind', 'instructions.md'), 'utf-8')).toBe(instructionsPart);
  });
});

describe('answerFragment', () => {
  it('is the same JSON as grind/answer.fragment.json', () => {
    expect(JSON.parse(readFileSync(join(root, 'grind', 'answer.fragment.json'), 'utf-8'))).toEqual(answerFragment);
  });

  it('describes asks, do, go, misses and said, and requires none of them', () => {
    expect(Object.keys(answerFragment.properties).sort()).toEqual(['asks', 'do', 'go', 'misses', 'said']);
    expect(answerFragment.required ?? []).toEqual([]);
  });

  it('validates an answer with asks', () => {
    expect(valid({ asks: ['todaysDrill', 'progress'] })).toBeUndefined();
    expect(valid(answerExamples.asks)).toBeUndefined();
  });

  it('validates an answer with do and go', () => {
    const answer = { said: 'Switched to the dark theme and opened John 3.', do: [{ name: 'setTheme', args: { theme: 'dark' } }], go: { name: 'chapter', args: { book: 'John', chapter: 3 } } };
    expect(valid(answer)).toBeUndefined();
    expect(valid(answerExamples.doAndGo)).toBeUndefined();
  });

  it('validates a miss', () => {
    expect(valid({ misses: [{ wanted: 'the verses he marked last week', why: 'no fact lists marked verses' }] })).toBeUndefined();
    expect(valid(answerExamples.miss)).toBeUndefined();
  });

  it('refuses a do lacking a name', () => {
    expect(valid({ do: [{ args: { theme: 'dark' } }] })).toBe('args.do[0].name is required');
    expect(valid({ do: [{ name: '' }] })).toMatch(/name must be at least 1 character/);
  });

  it('refuses a go lacking a name, a miss lacking its why, asks that are not names and an unknown field', () => {
    expect(valid({ go: { args: {} } })).toBe('args.go.name is required');
    expect(valid({ misses: [{ wanted: 'a thing' }] })).toBe('args.misses[0].why is required');
    expect(valid({ asks: [3] })).toBe('args.asks[0] must be a string');
    expect(valid({ said: 'ok', mood: 'happy' })).toBe('args.mood is not an arg it takes');
  });

  it('has an answer example for each of the four things the tutor can do, all of which the fragment accepts', () => {
    expect(Object.keys(answerExamples).sort()).toEqual(['asks', 'doAndGo', 'miss', 'sayOnly']);
    for (const [name, example] of Object.entries(answerExamples)) expect(valid(example), name).toBeUndefined();
  });
});

describe('the grind side meets the client', () => {
  it('has examples the tutor client carries out as written', async () => {
    const calls: string[] = [];
    const registry = defineRegistry({
      facts: [{ name: 'todaysDrill', tell: 'the drill', read: async () => ({ words: 3 }) }],
      commands: [{ name: 'setTheme', tell: 'changes the theme', kind: 'free', args: { type: 'object', properties: { theme: { enum: ['dark', 'light'] } }, required: ['theme'] }, run: async (args) => (calls.push(`setTheme ${JSON.stringify(args)}`), { said: 'Theme set.' }) }],
      places: [{ name: 'chapter', tell: 'opens a chapter', args: { type: 'object', properties: { book: { type: 'string' }, chapter: { type: 'integer' } }, required: ['book', 'chapter'] }, open: async (args) => void calls.push(`chapter ${JSON.stringify(args)}`) }],
    });
    // the app's own answer field (`answer`) goes beside the fragment's
    const withText = (example: object, answer = 'Done.') => ({ answer, ...example });
    const answers: unknown[] = [withText(answerExamples.doAndGo)];
    const tutor = createTutorClient<unknown>({ store: createMemoryStore(), send: async () => answers.shift(), registry, screen: () => 'home' });
    const talk = await tutor.start();
    const turn = await tutor.ask(talk.id, 'dark please, and show me John 3');
    expect(calls).toEqual(['setTheme {"theme":"dark"}', 'chapter {"book":"John","chapter":3}']);
    expect(turn.misses).toEqual([]);

    answers.push(withText(answerExamples.asks, 'One moment.'), withText({ said: 'Four words today.' }));
    const asked = await tutor.ask(talk.id, "what's on today?");
    expect(asked.rounds).toBe(2);
    expect(Object.keys(asked.asked)).toEqual(['todaysDrill']);

    answers.push(withText(answerExamples.miss, 'I cannot show that.'));
    expect((await tutor.ask(talk.id, 'show me what I marked')).misses).toHaveLength(1);
  });
});

describe('the package', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as { exports: Record<string, unknown>; files: string[] };
  const top = JSON.parse(readFileSync(join(root, '..', '..', 'package.json'), 'utf-8')) as { exports: Record<string, unknown>; files: string[] };

  it('exports ./grind as a subpath, in the library and in voice-kit', () => {
    expect(pkg.exports['./grind']).toEqual({ types: './dist/grind.d.ts', default: './dist/grind.js' });
    expect(top.exports['./talks/grind']).toEqual({ types: './packages/talks/dist/grind.d.ts', default: './packages/talks/dist/grind.js' });
  });

  it('ships the plain files of the grind part too', () => {
    expect(pkg.files).toContain('grind/**');
    expect(top.files).toContain('packages/*/grind/**');
  });

  it('is imported by nothing in the core and imports nothing itself', () => {
    const source = readFileSync(join(root, 'src', 'grind.ts'), 'utf-8');
    expect(source.match(/\b(?:from|import)\s*\(?\s*['"][^'"]+['"]/g) ?? []).toEqual([]);
    expect(readFileSync(join(root, 'src', 'index.ts'), 'utf-8')).not.toMatch(/from '\.\/grind/);
  });
});
