// router.ts: spoken words to a named command, and nothing more. normaliseSpoken makes the words plain (lower case, no punctuation,
// no leading or trailing 'please', number words as digits); route finds the first rule they fit and says its name and the words
// after the phrase. What the name means is the app's: it maps it to its own command, registry or function. No registry is imported
// and nothing here knows the DOM, so it runs in plain node.

/** A phrase that starts (or is) a command: plain words, matched on whole words; or a pattern, tested on the normalised words. */
export type SpokenPhrase = string | RegExp;

export interface SpokenRule {
  /** The name the app maps to its own command. */
  name: string;
  /** The phrases that start or are the command ('read', 'go to', 'next chapter'). A string is normalised as spoken words are. */
  phrases: SpokenPhrase[];
  /** The words after the phrase are the command's argument (read john 3). When false, extra words mean this rule does not fit. */
  rest?: boolean;
}

export interface SpokenRoute {
  /** The matched rule's name. */
  name: string;
  /** The normalised words after the phrase: '' when there are none or the rule takes none. */
  rest: string;
  /** All the normalised words. */
  words: string;
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3 };

const isUnit = (w: string | undefined): w is string => w !== undefined && w in UNITS && UNITS[w] < 10 && UNITS[w] > 0;

/** Reads one number from the words at `at`: its value and how many words it took, or undefined when a number word does not start here. */
function numberAt(words: string[], at: number): { value: number; length: number } | undefined {
  const w = words[at];
  if (w === undefined) return undefined;
  let value: number;
  let length = 1;
  if (w in TENS) {
    value = TENS[w];
    if (isUnit(words[at + 1])) {
      value += UNITS[words[at + 1]];
      length = 2;
    }
    return { value, length };
  }
  if (!(w in UNITS)) return undefined;
  value = UNITS[w];
  if (isUnit(w) && words[at + 1] === 'hundred') {
    value *= 100;
    length = 2;
    let next = at + 2;
    if (words[next] === 'and') next++;
    const tail = numberAt(words, next);
    if (tail && tail.value > 0 && tail.value < 100) {
      value += tail.value;
      length = next + tail.length - at;
    }
  }
  return { value, length };
}

/**
 * The words as the router reads them: lower case, punctuation off (a hyphen is a space, an apostrophe goes), a leading and a trailing
 * 'please' off, number words as digits ('three' 3, 'twenty one' 21, 'one hundred nineteen' 119) and ordinals ('first' and '1st' 1,
 * 'second' 2, 'third' 3).
 */
export function normaliseSpoken(words: string): string {
  const tokens = words
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
  if (tokens[0] === 'please') tokens.shift();
  if (tokens[tokens.length - 1] === 'please') tokens.pop();
  const out: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i];
    const digits = /^(\d+)(?:st|nd|rd|th)$/.exec(t);
    if (digits) {
      out.push(digits[1]);
      i++;
    } else if (t in ORDINALS) {
      out.push(String(ORDINALS[t]));
      i++;
    } else {
      const n = numberAt(tokens, i);
      if (n) {
        out.push(String(n.value));
        i += n.length;
      } else {
        out.push(t);
        i++;
      }
    }
  }
  return out.join(' ');
}

/** Rules ready to route by: each string phrase normalised as spoken words are, so 'go to' and 'Go To' are the same phrase. */
export type SpokenRules = readonly SpokenRule[];

export function defineSpoken(rules: readonly SpokenRule[]): SpokenRules {
  return rules.map((r) => ({ ...r, phrases: r.phrases.map((p) => (typeof p === 'string' ? normaliseSpoken(p) : p)).filter((p) => p !== '') }));
}

/** How many leading characters of `words` the phrase takes, or -1. A string matches whole words only; a pattern must match from the start. */
function takes(words: string, phrase: SpokenPhrase): number {
  if (typeof phrase === 'string') {
    if (words === phrase) return phrase.length;
    return words.startsWith(phrase + ' ') ? phrase.length : -1;
  }
  const flags = phrase.flags.replace(/[gy]/g, '');
  const m = new RegExp(phrase.source, flags).exec(words);
  if (!m || m.index !== 0) return -1;
  const end = m[0].length;
  return end === words.length || words[end] === ' ' || m[0].endsWith(' ') ? end : -1;
}

/** The first rule the words fit: its name and the words after its phrase; undefined when none fits. */
export function route(words: string, rules: SpokenRules): SpokenRoute | undefined {
  const plain = normaliseSpoken(words);
  if (plain === '') return undefined;
  for (const rule of rules) {
    for (const phrase of rule.phrases) {
      const end = takes(plain, phrase);
      if (end < 0) continue;
      const rest = plain.slice(end).trim();
      if (rest !== '' && !rule.rest) continue;
      return { name: rule.name, rest: rule.rest ? rest : '', words: plain };
    }
  }
  return undefined;
}
