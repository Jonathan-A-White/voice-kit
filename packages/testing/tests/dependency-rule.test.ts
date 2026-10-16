// testing stands alone: it imports nothing from composer or speech, declares no dependency, and reaches the
// page only through the window it is handed (the fakes are installed on a target, and the init script's own globalThis).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
const read = (f: string): string => readFileSync(join(srcDir, f), 'utf-8');
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('packages/testing', () => {
  it('has source to check', () => {
    expect(files).toEqual(expect.arrayContaining(['speech.ts', 'mic.ts', 'clips.ts', 'index.ts']));
  });

  it('imports only its own files', () => {
    const specifiers = files.flatMap((f) => [...read(f).matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]));
    expect(specifiers.filter((s) => !s.startsWith('./'))).toEqual([]);
  });

  it('never names the global window, document or navigator (only the target it is handed has them)', () => {
    const hits = files.flatMap((f) =>
      [...withoutComments(read(f)).matchAll(/(?<![.\w'"])(window|document|navigator)\b(?!['"])/g)].map((m) => `${f}: ${m[1]}`),
    );
    expect(hits).toEqual([]);
  });

  it('declares no dependency in its package.json', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as Record<string, unknown>;
    for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      expect(Object.keys((pkg[k] as Record<string, string> | undefined) ?? {})).toEqual([]);
    }
  });
});
