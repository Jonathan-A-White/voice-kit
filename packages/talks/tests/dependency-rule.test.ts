// talks stands alone: its core imports nothing but its own files, so it runs in a worker, in node and in the browser, and no other
// voice-kit library is needed to keep a talk. Two files are the exceptions that keep the core clean, each its own entry point:
// the Dexie store (imports dexie) and TalkList (imports react). Nothing in the other libraries imports talks.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packages = resolve(root, '..');
const sourceOf = (dir: string) => readdirSync(dir, { recursive: true, encoding: 'utf-8' }).filter((f) => /\.tsx?$/.test(f)).map((f) => join(dir, f));
const specifiers = (file: string) => [...readFileSync(file, 'utf-8').matchAll(/\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

describe('packages/talks', () => {
  const files = sourceOf(join(root, 'src'));

  it('has source to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // the file of each entry point that is allowed one outside import
  const outside: Record<string, string> = { 'dexieStore.ts': 'dexie', 'TalkList.tsx': 'react' };
  const external = (file: string) => specifiers(file).filter((s) => !s.startsWith('./'));

  it('imports only its own files, but for the Dexie store (dexie) and TalkList (react)', () => {
    expect(Object.fromEntries(files.map((f) => [relative(join(root, 'src'), f), [...new Set(external(f))]]).filter(([, s]) => s.length > 0))).toEqual({
      'dexieStore.ts': ['dexie'],
      'TalkList.tsx': ['react'],
    });
    expect(Object.keys(outside)).toEqual(expect.arrayContaining(files.map((f) => relative(join(root, 'src'), f)).filter((f) => external(join(root, 'src', f)).length > 0)));
  });

  it('keeps the core entry point (index.ts and what it exports) free of both', () => {
    const seen = new Set<string>();
    const walk = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const s of specifiers(file).filter((s) => s.startsWith('./'))) walk(join(dirname(file), s.replace(/\.js$/, '')) + (existsSync(join(dirname(file), s.replace(/\.js$/, '.ts'))) ? '.ts' : '.tsx'));
    };
    walk(join(root, 'src', 'index.ts'));
    expect([...seen].flatMap(external)).toEqual([]);
  });

  it('has no dependency, and only dexie and react as optional peers', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as { dependencies?: object; peerDependencies?: Record<string, string>; peerDependenciesMeta?: Record<string, { optional?: boolean }> };
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(Object.keys(pkg.peerDependencies ?? {}).sort()).toEqual(['dexie', 'react']);
    expect(Object.values(pkg.peerDependenciesMeta ?? {}).map((m) => m.optional)).toEqual([true, true]);
  });

  it('is imported by no other library', () => {
    const others = ['composer', 'speech', 'testing'].flatMap((name) => sourceOf(join(packages, name, 'src')));
    expect(others.length).toBeGreaterThan(0);
    expect(others.flatMap((file) => specifiers(file).filter((s) => !s.startsWith('.') && /talks/.test(s)).map((s) => `${file}: ${s}`))).toEqual([]);
  });
});
