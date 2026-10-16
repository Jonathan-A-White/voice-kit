// composer stands alone: it imports only React and its own files, nothing from speech or testing, and neither of them
// imports it. React and the DOM live here; speech has the DOM too, and React only in its optional React entry.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packages = resolve(root, '..');
const sourceOf = (dir: string) => readdirSync(dir).filter((f) => /\.tsx?$/.test(f)).map((f) => join(dir, f));
const specifiers = (file: string) => [...readFileSync(file, 'utf-8').matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

describe('packages/composer', () => {
  const files = sourceOf(join(root, 'src'));

  it('has source to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('imports only React and its own files', () => {
    const outside = files.flatMap(specifiers).filter((s) => !s.startsWith('./'));
    expect([...new Set(outside)].sort()).toEqual(['react', 'react-dom']);
  });

  it('declares React as its only peers and has no dependency of its own', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as Record<string, Record<string, string> | undefined>;
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    expect(Object.keys(pkg.peerDependencies ?? {}).sort()).toEqual(['react', 'react-dom']);
  });

  it('is imported by no other library', () => {
    const others = ['speech', 'testing'].flatMap((name) => {
      const src = join(packages, name, 'src');
      return readdirSync(src, { recursive: true, encoding: 'utf-8' })
        .filter((f) => /\.tsx?$/.test(f))
        .map((f) => join(src, f));
    });
    expect(others.length).toBeGreaterThan(0);
    const hits = others.flatMap((file) => specifiers(file).filter((s) => /composer/.test(s)).map((s) => `${file}: ${s}`));
    expect(hits).toEqual([]);
  });
});
