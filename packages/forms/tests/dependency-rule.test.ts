// forms imports only types from voice-kit/talks (the Command and its args schema it makes), and nothing else: no React, no DOM, no
// other voice-kit library, no dependency. A type import is erased, so the built package imports nothing at all.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(join(root, 'src'), { recursive: true, encoding: 'utf-8' }).filter((f) => /\.tsx?$/.test(f)).map((f) => join(root, 'src', f));
const imports = (file: string) => [...readFileSync(file, 'utf-8').matchAll(/\b(import|export)\s+(type\s+)?(?:[^'";]*?\bfrom\s*)?['"]([^'"]+)['"]/g)].map((m) => ({ type: m[2] !== undefined, from: m[3] }));

describe('packages/forms', () => {
  it('has source to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('imports only its own files, and only types from voice-kit/talks', () => {
    const outside = files.flatMap((file) => imports(file).filter((i) => !i.from.startsWith('./')));
    expect(outside.length).toBeGreaterThan(0);
    expect(outside.filter((i) => !(i.from === 'voice-kit/talks' && i.type))).toEqual([]);
  });

  it('has no dependency and no peer dependency', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as { dependencies?: object; peerDependencies?: object };
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies ?? {}).toEqual({});
  });

  it('is imported by no other library', () => {
    const others = ['composer', 'speech', 'talks', 'testing'].flatMap((name) =>
      readdirSync(join(root, '..', name, 'src'), { recursive: true, encoding: 'utf-8' }).filter((f) => /\.tsx?$/.test(f)).map((f) => join(root, '..', name, 'src', f)),
    );
    expect(others.flatMap((file) => imports(file).filter((i) => /forms/.test(i.from)).map((i) => `${file}: ${i.from}`))).toEqual([]);
  });
});
