import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allDependencies,
  creditsSection,
  parseCredits,
  problemsWithAssets,
  problemsWithCredits,
  runtimeDependencies,
  shippedAssets,
} from './credits.mjs';

const NEWTON = 'If I have seen further it is by standing on the shoulders of Giants.';

const GOOD = `# x

## Credits

> "${NEWTON}"
> Isaac Newton, letter to Robert Hooke, 1675

- [alpha](https://example.org/alpha): used for a. Licence: [MIT](https://example.org/mit). No changes. Kind: package.
- [@scope/beta](https://example.org/beta): used for b. Licence: [Apache-2.0](https://example.org/apache). No changes. Kind: package.
- [Some Service](https://example.org/svc): reads c. Licence: [terms](https://example.org/terms). Kind: service.

## Develop
`;

describe('README Credits', () => {
  it('passes a section that opens with Newton and credits every dependency', () => {
    expect(problemsWithCredits(GOOD, ['alpha', '@scope/beta'])).toEqual([]);
  });

  it('fails when a runtime dependency is missing from Credits', () => {
    expect(problemsWithCredits(GOOD, ['alpha', '@scope/beta', 'gamma'])).toEqual([
      'runtime dependency gamma is not credited (add a credit whose link text is "gamma")',
    ]);
  });

  it('fails when there is no Credits section', () => {
    expect(problemsWithCredits('# x\n\n## Develop\n', [])).toEqual(['README.md has no "## Credits" section']);
  });

  it("fails when the section does not open with Newton's line and attribution", () => {
    const text = GOOD.replace(NEWTON, 'Something else.');
    expect(problemsWithCredits(text, ['alpha', '@scope/beta'])).toEqual([
      "Credits must open with Newton's line, \"If I have seen further it is by standing on the shoulders of Giants\", attributed to Isaac Newton",
    ]);
  });

  it('fails a credit with a raw URL as its link text, no licence link or no use', () => {
    const text = GOOD.replace('[alpha](https://example.org/alpha)', '[https://example.org/alpha](https://example.org/alpha)').replace(
      'Licence: [Apache-2.0](https://example.org/apache).',
      'Licence: Apache-2.0.',
    );
    expect(problemsWithCredits(text.replace('Kind: package.', 'Kind: tool.'), ['@scope/beta'])).toEqual([
      'credit "https://example.org/alpha" has a URL as its link text',
      'credit "@scope/beta" has no licence link ("Licence: [name](url)")',
    ]);
  });

  it('reads the credits as link text, with the rest of the line', () => {
    expect(parseCredits(creditsSection(GOOD)).map((c) => c.name)).toEqual(['alpha', '@scope/beta', 'Some Service']);
  });

  it('holds for this repo: every package.json dependency is credited', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    expect(runtimeDependencies()).toEqual([]); // voice-kit's only runtime needs are React, a peer the app brings
    expect(problemsWithCredits(readme, runtimeDependencies(), allDependencies())).toEqual([]);
  });

  it('fails a credit for a package that is no longer a dependency', () => {
    expect(problemsWithCredits(GOOD, ['alpha'], ['alpha'])).toEqual([
      'credit "@scope/beta" is a package that is no longer a dependency (remove the credit, or give it another Kind)',
    ]);
  });

  it('passes a package credit when the package is only a devDependency', () => {
    expect(problemsWithCredits(GOOD, ['alpha'], ['alpha', '@scope/beta'])).toEqual([]);
  });

  it('leaves credits of other kinds alone: a service is not a package', () => {
    expect(problemsWithCredits(GOOD, ['alpha', '@scope/beta'], ['alpha', '@scope/beta'])).toEqual([]);
    expect(parseCredits(creditsSection(GOOD)).map((c) => c.kind)).toEqual(['package', 'package', 'service']);
  });

  it('fails a credit with no Kind or an unknown Kind', () => {
    const text = GOOD.replace(' Kind: service.', '').replace('No changes. Kind: package.\n- [@scope', 'No changes. Kind: gadget.\n- [@scope');
    expect(problemsWithCredits(text, ['alpha', '@scope/beta'], ['alpha', '@scope/beta'])).toEqual([
      'credit "alpha" has an unknown Kind "gadget" (use package, tool, service, idea, font or data)',
      'credit "Some Service" has no Kind ("Kind: package." and so on)',
    ]);
  });

  it('matches a package credit to its npm name in any letter case', () => {
    const text = GOOD.replace('[alpha]', '[Alpha]');
    expect(problemsWithCredits(text, ['alpha', '@scope/beta'], ['alpha', '@scope/beta'])).toEqual([]);
    expect(problemsWithCredits(text, ['@scope/beta'], ['@scope/beta'])).toEqual([
      'credit "Alpha" is a package that is no longer a dependency (remove the credit, or give it another Kind)',
    ]);
  });

  it('reads dependencies and devDependencies from this repo', () => {
    expect(allDependencies()).toEqual(expect.arrayContaining(['react', 'vitest', 'vite']));
  });
});

describe('fonts and data files', () => {
  const credits = [
    { name: 'Inter', kind: 'font', text: '- [Inter](https://rsms.me/inter): the body font, `public/fonts/Inter.woff2`. Kind: font.' },
    { name: 'Words', kind: 'data', text: '- [Words](https://example.org/w): word list in `public/data`. Kind: data.' },
  ];

  it('finds font and data files, and skips node_modules, dist and test fixtures', () => {
    const root = mkdtempSync(join(tmpdir(), 'credits-'));
    for (const file of [
      'public/fonts/Inter.woff2',
      'public/data/words.csv',
      'packages/b/clips/english.wav',
      'node_modules/x/y.ttf',
      'packages/a/dist/z.otf',
      'packages/a/tests/fixtures/vector.csv',
      'src/index.ts',
    ]) {
      mkdirSync(join(root, file, '..'), { recursive: true });
      writeFileSync(join(root, file), 'x');
    }
    expect(shippedAssets(root)).toEqual(['packages/b/clips/english.wav', 'public/data/words.csv', 'public/fonts/Inter.woff2']);
  });

  it('passes when each file, or the folder it is in, is named by a font or data credit', () => {
    expect(problemsWithAssets(['public/fonts/Inter.woff2', 'public/data/words.csv'], credits)).toEqual([]);
  });

  it('fails a font file that no credit names', () => {
    expect(problemsWithAssets(['public/fonts/Lora.woff2'], credits)).toEqual([
      'bundled file public/fonts/Lora.woff2 is not credited (add a font or data credit that names it or its folder in backticks)',
    ]);
  });

  it('does not let a credit of another kind cover a file', () => {
    const idea = [{ name: 'Idea', kind: 'idea', text: '- [Idea](https://example.org): `public/fonts/Lora.woff2`. Kind: idea.' }];
    expect(problemsWithAssets(['public/fonts/Lora.woff2'], idea)).toHaveLength(1);
  });

  it('holds for this repo: it bundles no font or data files, and any it gets must be credited', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    const credits = parseCredits(creditsSection(readme));
    expect(problemsWithAssets(shippedAssets(), credits)).toEqual([]);
  });
});
