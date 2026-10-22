// talks stands alone: it imports nothing but its own files, so it runs in a worker, in node and in the browser, and no other
// voice-kit library is needed to keep a talk. Nothing in the other libraries imports it.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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

  it('imports only its own files', () => {
    expect([...new Set(files.flatMap(specifiers).filter((s) => !s.startsWith('./')))]).toEqual([]);
  });

  it('has no dependency and no peer of its own', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as Record<string, unknown>;
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });

  it('is imported by no other library', () => {
    const others = ['composer', 'speech', 'testing'].flatMap((name) => sourceOf(join(packages, name, 'src')));
    expect(others.length).toBeGreaterThan(0);
    expect(others.flatMap((file) => specifiers(file).filter((s) => !s.startsWith('.') && /talks/.test(s)).map((s) => `${file}: ${s}`))).toEqual([]);
  });
});
