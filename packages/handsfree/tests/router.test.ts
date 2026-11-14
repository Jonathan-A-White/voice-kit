// The spoken-command router: words in, a named command out, nothing else (the app maps the name to its own command).
import { describe, expect, it } from 'vitest';
import { defineSpoken, normaliseSpoken, route } from '../src/router.js';

const rules = defineSpoken([
  { name: 'read', phrases: ['read', 'open', 'go to'], rest: true },
  { name: 'pause', phrases: ['pause'] },
  { name: 'play', phrases: ['play', 'resume', 'continue', 'go on'] },
  { name: 'stop', phrases: ['stop'] },
  { name: 'next', phrases: ['next chapter'] },
  { name: 'ask', phrases: ['ask'], rest: true },
]);

describe('normaliseSpoken', () => {
  it('lower-cases, drops punctuation and a leading or trailing please, and turns number words into digits', () => {
    expect(normaliseSpoken('Read John three, please.')).toBe('read john 3');
    expect(normaliseSpoken('Please, read John 3')).toBe('read john 3');
    expect(normaliseSpoken('first john two')).toBe('1 john 2');
    expect(normaliseSpoken('Romans eight verse twenty eight')).toBe('romans 8 verse 28');
    expect(normaliseSpoken('Psalm one hundred nineteen')).toBe('psalm 119');
    expect(normaliseSpoken('twenty one')).toBe('21');
    expect(normaliseSpoken('1st John 2')).toBe('1 john 2');
    expect(normaliseSpoken('second Corinthians')).toBe('2 corinthians');
    expect(normaliseSpoken('Third John')).toBe('3 john');
    expect(normaliseSpoken("  What's   that?  ")).toBe('whats that');
    expect(normaliseSpoken('')).toBe('');
  });
});

describe('route', () => {
  it('gives the name, the rest and the normalised words of the first rule that fits', () => {
    expect(route('read john 3', rules)).toEqual({ name: 'read', rest: 'john 3', words: 'read john 3' });
    expect(route('Please go to Romans eight', rules)).toEqual({ name: 'read', rest: 'romans 8', words: 'go to romans 8' });
    expect(route('pause', rules)).toEqual({ name: 'pause', rest: '', words: 'pause' });
    expect(route('Go on.', rules)?.name).toBe('play');
    expect(route('next chapter', rules)?.name).toBe('next');
    expect(route('ask who was nicodemus', rules)).toEqual({ name: 'ask', rest: 'who was nicodemus', words: 'ask who was nicodemus' });
  });

  it('gives nothing when no rule fits a whole word', () => {
    expect(route('paused', rules)).toBeUndefined();
    expect(route('playground', rules)).toBeUndefined();
    expect(route('', rules)).toBeUndefined();
    expect(route('  ,. ', rules)).toBeUndefined();
    expect(route('read', rules)?.rest).toBe('');
  });

  it('does not take extra words after a command that takes no rest', () => {
    expect(route('pause the music', rules)).toBeUndefined();
    expect(route('next chapter please', rules)?.name).toBe('next');
  });

  it('lets the first fitting rule win', () => {
    const both = defineSpoken([
      { name: 'first', phrases: ['go'], rest: true },
      { name: 'second', phrases: ['go on'] },
    ]);
    expect(route('go on', both)?.name).toBe('first');
  });

  it('takes patterns as well as phrases, and a pattern sees the normalised words', () => {
    const patterned = defineSpoken([{ name: 'chapter', phrases: [/^chapter (\d+)$/], rest: false }]);
    expect(route('Chapter twelve', patterned)).toEqual({ name: 'chapter', rest: '', words: 'chapter 12' });
    expect(route('chapter twelve and more', patterned)).toBeUndefined();
  });
});
