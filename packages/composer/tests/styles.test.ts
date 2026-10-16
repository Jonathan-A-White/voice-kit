// The look is the app's: styles.css sets every colour through a --bk-composer-* property (with a default), and
// styles only the composer's own classes, so an app themes it without touching the component.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '');
const COLOUR = /#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(|\bCanvas(?:Text)?\b/i;

describe('styles.css', () => {
  it('sets every colour through a --bk-composer-* custom property', () => {
    const bare = css
      .split('\n')
      .filter((line) => COLOUR.test(line.replace(/var\(--bk-composer-[\w-]+,(?:[^()]|\([^()]*\))*\)/g, '')));
    expect(bare).toEqual([]);
  });

  it('styles only the bk-composer classes', () => {
    const selectors = [...css.matchAll(/^([^{}@\n][^{}]*)\{/gm)].flatMap((m) => m[1].split(',').map((s) => s.trim()));
    expect(selectors.length).toBeGreaterThan(10);
    expect(selectors.filter((s) => !s.startsWith('.bk-composer'))).toEqual([]);
  });
});
