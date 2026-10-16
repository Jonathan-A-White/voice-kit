// speech stands alone: the engine (every file but react.tsx) imports nothing, the React entry imports only React and its
// own files, nothing from composer or testing, and none of them imports it. React is an
// optional peer: an app that only wants the engine does not need it. The DOM lives here (speechSynthesis, the page's visibility).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packages = resolve(root, '..');
const sourceOf = (dir: string) => readdirSync(dir).filter((f) => /\.tsx?$/.test(f));
const specifiers = (file: string) => [...readFileSync(file, 'utf-8').matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

describe('packages/speech', () => {
  const files = sourceOf(join(root, 'src'));

  it('has source to check', () => {
    expect(files).toEqual(expect.arrayContaining(['index.ts', 'react.tsx']));
  });

  it('the engine imports only its own files, the React entry only React besides', () => {
    for (const file of files) {
      const outside = specifiers(join(root, 'src', file)).filter((s) => !s.startsWith('./'));
      expect([...new Set(outside)], file).toEqual(file === 'react.tsx' ? ['react'] : []);
    }
  });

  it('declares react as an optional peer and has no dependency of its own', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as Record<string, Record<string, unknown> | undefined>;
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    expect(Object.keys(pkg.peerDependencies ?? {})).toEqual(['react']);
    expect(pkg.peerDependenciesMeta).toEqual({ react: { optional: true } });
  });

  it('is imported by no other library', () => {
    const others = ['composer', 'testing'].flatMap((name) => {
      const src = join(packages, name, 'src');
      return readdirSync(src, { recursive: true, encoding: 'utf-8' })
        .filter((f) => /\.tsx?$/.test(f))
        .map((f) => join(src, f));
    });
    expect(others.length).toBeGreaterThan(0);
    const hits = others.flatMap((file) => specifiers(file).filter((s) => !s.startsWith('.') && /speech/.test(s)).map((s) => `${file}: ${s}`));
    expect(hits).toEqual([]);
  });
});
