// The README's Credits section is the About of a library. This checks it: it opens with Newton's line,
// attributed; each credit has its name as link text (never a raw URL), a licence link and a "Kind: x."; every
// runtime dependency in a package.json is credited; a "Kind: package." credit names a package that is still
// a dependency, by npm name in any letter case (a removed library loses its credit in the same commit); and every bundled font or data file
// is named by a font or data credit. Run through npm test (scripts/credits.test.mjs).
import { readdirSync, readFileSync } from 'node:fs';

export const KINDS = ['package', 'tool', 'service', 'idea', 'font', 'data'];

const ROOT = new URL('../', import.meta.url);

/** Names of every dependency (of the given kinds) in the root package.json, packages/*\/package.json and examples/*\/package.json. */
function dependencyNames(fields) {
  const manifests = [new URL('package.json', ROOT)];
  for (const group of ['packages', 'examples']) {
    for (const dir of readdirSync(new URL(`${group}/`, ROOT), { withFileTypes: true })) {
      if (dir.isDirectory()) manifests.push(new URL(`${group}/${dir.name}/package.json`, ROOT));
    }
  }
  const names = new Set();
  for (const url of manifests) {
    const manifest = JSON.parse(readFileSync(url, 'utf8'));
    for (const field of fields) for (const name of Object.keys(manifest[field] ?? {})) names.add(name);
  }
  return [...names].sort();
}

/** Names of every runtime dependency. */
export function runtimeDependencies() {
  return dependencyNames(['dependencies']);
}

/** Names of every dependency and devDependency: what a "Kind: package." credit may name. */
export function allDependencies() {
  return dependencyNames(['dependencies', 'devDependencies']);
}

const FONT_OR_DATA = /\.(woff2?|ttf|otf|eot|csv|tsv|sqlite3?|db|wav)$/i;
const SKIPPED_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage']);

/** Repo-relative paths of the font and data files the repo bundles (not node_modules, dist or tests/fixtures), sorted. */
export function shippedAssets(root = ROOT) {
  const base = root instanceof URL ? root.pathname : root.replace(/\/?$/, '/');
  const found = [];
  const walk = (relative) => {
    for (const entry of readdirSync(base + relative, { withFileTypes: true })) {
      const path = relative + entry.name;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name) && !path.endsWith('tests/fixtures')) walk(path + '/');
      } else if (FONT_OR_DATA.test(entry.name)) found.push(path);
    }
  };
  walk('');
  return found.sort();
}

/** What is wrong with the bundled files' credits: each must be named, or its folder, in backticks in a font or data credit. */
export function problemsWithAssets(files, credits) {
  const covering = credits.filter((c) => c.kind === 'font' || c.kind === 'data');
  const problems = [];
  for (const file of files) {
    const places = [file];
    for (let i = file.lastIndexOf('/'); i > 0; i = file.lastIndexOf('/', i - 1)) places.push(file.slice(0, i));
    const named = covering.some((c) => places.some((place) => c.text.includes('`' + place + '`') || c.text.includes('`' + place + '/`')));
    if (!named) {
      problems.push(`bundled file ${file} is not credited (add a font or data credit that names it or its folder in backticks)`);
    }
  }
  return problems;
}

/** The text under "## Credits", up to the next "## " heading; null when there is none. */
export function creditsSection(readme) {
  const lines = readme.split('\n');
  const start = lines.findIndex((line) => /^## Credits\s*$/.test(line));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** Each "- [Name](url) ..." list item (with its continuation lines) as { name, kind, text }; kind is '' when it has none. */
export function parseCredits(section) {
  const items = [];
  for (const line of section.split('\n')) {
    if (/^- /.test(line)) items.push(line);
    else if (items.length > 0 && /^\s+\S/.test(line)) items[items.length - 1] += ' ' + line.trim();
  }
  return items.map((text) => ({
    name: /^- \[([^\]]+)\]\(/.exec(text)?.[1] ?? '',
    kind: /Kind: ([a-z]+)\./.exec(text)?.[1] ?? '',
    text,
  }));
}

/** What is wrong with the README's Credits, as sentences; empty when it is right. */
export function problemsWithCredits(readme, dependencies, allDeps = dependencies) {
  const section = creditsSection(readme);
  if (section === null) return ['README.md has no "## Credits" section'];
  const problems = [];
  const opening = section.trim().split('\n').filter((line) => line.startsWith('>')).join(' ');
  if (!opening.includes('If I have seen further it is by standing on the shoulders of Giants') || !opening.includes('Isaac Newton')) {
    problems.push(
      'Credits must open with Newton\'s line, "If I have seen further it is by standing on the shoulders of Giants", attributed to Isaac Newton',
    );
  }
  const credits = parseCredits(section);
  for (const { name, kind, text } of credits) {
    if (name === '') problems.push(`a credit does not start with its name as link text: ${text.slice(0, 60)}`);
    else if (/^https?:/i.test(name)) problems.push(`credit "${name}" has a URL as its link text`);
    else if (!/Licen[cs]e: \[[^\]]+\]\(https?:\/\/[^)]+\)/.test(text)) {
      problems.push(`credit "${name}" has no licence link ("Licence: [name](url)")`);
    }
    if (name === '') continue;
    if (kind === '') problems.push(`credit "${name}" has no Kind ("Kind: package." and so on)`);
    else if (!KINDS.includes(kind)) {
      problems.push(`credit "${name}" has an unknown Kind "${kind}" (use ${KINDS.slice(0, -1).join(', ')} or ${KINDS.at(-1)})`);
    } else if (kind === 'package' && !allDeps.some((dep) => dep.toLowerCase() === name.toLowerCase())) {
      problems.push(`credit "${name}" is a package that is no longer a dependency (remove the credit, or give it another Kind)`);
    }
  }
  const credited = new Set(credits.map((c) => c.name.toLowerCase()));
  for (const dependency of dependencies) {
    if (!credited.has(dependency.toLowerCase())) {
      problems.push(`runtime dependency ${dependency} is not credited (add a credit whose link text is "${dependency}")`);
    }
  }
  return problems;
}
