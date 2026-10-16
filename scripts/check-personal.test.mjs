import { describe, expect, it } from 'vitest';
import { findPersonal } from './check-personal.mjs';

const KEY = '03' + 'ab'.repeat(32);

describe('check:personal', () => {
  it('passes clean files', () => {
    expect(findPersonal([{ path: 'README.md', text: 'Nothing personal here.\nhttps://postern.example\n' }])).toEqual([]);
  });

  it('fails on a planted host name, home path and public key, with path and line', () => {
    const files = [
      { path: 'a.ts', text: 'ok\nconst u = "https://postern.' + 'allmy' + 'mind.org";\n' },
      { path: 'b.md', text: 'see /ho' + 'me/someone/project\n' },
      { path: 'c.ts', text: `const k = '${KEY}';\n` },
    ];
    expect(findPersonal(files)).toEqual([
      { path: 'a.ts', line: 2, rule: 'host name' },
      { path: 'b.md', line: 1, rule: 'home-directory path' },
      { path: 'c.ts', line: 1, rule: 'public key' },
    ]);
  });

  it('allows a public key in a test fixture but not a host name there', () => {
    expect(findPersonal([{ path: 'packages/bsv/tests/fixtures/x.json', text: `{"k":"${KEY}"}` }])).toEqual([]);
    expect(findPersonal([{ path: 'packages/bsv/tests/fixtures/x.json', text: 'allmy' + 'mind' }])).toHaveLength(1);
  });

  it('does not take a longer hex string for a public key', () => {
    expect(findPersonal([{ path: 'a.ts', text: `'${KEY}00'` }])).toEqual([]);
  });
});
