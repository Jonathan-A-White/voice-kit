// Fails when a tracked file holds something personal: the owner's host name, a home-directory path, or a
// full public key (66 hex characters starting 02 or 03) outside the test fixtures, which are recorded
// data. Run: npm run check:personal (it is part of npm test). The patterns are built from pieces so this
// file does not match itself.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RULES = [
  { name: 'host name', pattern: new RegExp('all' + 'mymind', 'i') },
  { name: 'home-directory path', pattern: new RegExp('/ho' + 'me/') },
  { name: 'public key', pattern: /\b0[23][0-9a-fA-F]{64}\b/, skip: (path) => /(^|\/)tests\/fixtures\//.test(path) },
];

/** @param {{ path: string, text: string }[]} files @returns {{ path: string, line: number, rule: string }[]} */
export function findPersonal(files) {
  const found = [];
  for (const { path, text } of files) {
    text.split('\n').forEach((content, i) => {
      for (const rule of RULES) {
        if (!rule.skip?.(path) && rule.pattern.test(content)) found.push({ path, line: i + 1, rule: rule.name });
      }
    });
  }
  return found;
}

function trackedFiles() {
  const paths = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  return paths.flatMap((path) => {
    try {
      const text = readFileSync(path, 'utf8');
      return text.includes('\0') ? [] : [{ path, text }];
    } catch {
      return []; // deleted in the working tree, or a directory (submodule)
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = findPersonal(trackedFiles());
  for (const f of found) console.error(`${f.path}:${f.line}: ${f.rule}`);
  if (found.length > 0) {
    console.error(`check:personal failed: ${found.length} personal thing(s) in tracked files.`);
    process.exit(1);
  }
  console.log('check:personal passed: nothing personal in tracked files.');
}
