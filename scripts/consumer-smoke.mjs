// The consumer smoke test: installs voice-kit the way an app does, `npm install git+file://<a fresh clone>`,
// into a scratch directory, and checks from there what a git install must deliver:
//   - 'voice-kit/composer' renders with the React the app installs, its styles.css is packed, and its import graph
//     reaches no other voice-kit library;
//   - 'voice-kit/speech' speaks sentence by sentence through the honest fake, and 'voice-kit/speech/react' renders its
//     SpeakingBar with the same React; packages/speech/dist and its styles.css are packed;
//   - 'voice-kit/talks' keeps a talk through an injected grind, with a picture turn, in plain node (no React); packages/talks/dist is packed;
//     'voice-kit/talks/dexie' keeps it in IndexedDB (fake-indexeddb) and 'voice-kit/talks/react' renders TalkList with the app's React;
//   - 'voice-kit/talks/grind' gives the grind's instructions part and answer fragment in plain node, and the tutor client carries out its examples;
//   - 'voice-kit/testing/talks' drives that loop with a scripted grind and a recording store;
//   - 'voice-kit/testing/speech' and 'voice-kit/testing/mic' run in the vitest the app installs (fake timers), by import
//     and by init script.
// The "fresh clone" is the working tree as it stands (tracked and untracked files, minus what git ignores),
// committed into a scratch repository, so an edit not yet committed is smoke-tested too.
// Run: npm run smoke   (needs the network or a warm npm cache: the install runs the build with devDependencies)
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(join(tmpdir(), 'voice-kit-smoke-'));
const run = (cmd, args, cwd, extra = {}) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], ...extra });

try {
  // 1. A fresh clone of the tree.
  const clone = join(scratch, 'clone');
  mkdirSync(clone);
  const files = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root).split('\0').filter(Boolean);
  for (const f of files) {
    if (!existsSync(join(root, f))) continue; // deleted in the working tree
    mkdirSync(dirname(join(clone, f)), { recursive: true });
    cpSync(join(root, f), join(clone, f));
  }
  const git = (...args) => run('git', ['-c', 'user.name=smoke', '-c', 'user.email=smoke@example.invalid', ...args], clone);
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'smoke');

  // 2. An app's scratch directory that installs it.
  const app = join(scratch, 'app');
  mkdirSync(app);
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'smoke-app', private: true, type: 'module' }));
  console.log('installing voice-kit from a fresh clone ...');
  run('npm', ['install', '--no-audit', '--no-fund', `git+file://${clone}`], app, { timeout: 480_000 });
  const installed = join(app, 'node_modules', 'voice-kit');

  // The exports map names the entry points (and package.json), nothing else: no deep imports.
  const entries = Object.keys(JSON.parse(readFileSync(join(installed, 'package.json'), 'utf-8')).exports).sort();
  const expected = ['./composer', './composer/styles.css', './package.json', './speech', './speech/react', './speech/styles.css', './talks', './talks/dexie', './talks/grind', './talks/react', './talks/styles.css', './testing/mic', './testing/speech', './testing/talks'];
  if (JSON.stringify(entries) !== JSON.stringify(expected)) throw new Error('exports: ' + entries.join(', '));
  console.log('the exports map names the entry points');

  // Each library stands alone: walk an installed entry point's import graph and fail on any other voice-kit library.
  const specifier = /\b(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  const standsAlone = (entry) => {
    const seen = new Set();
    const walk = (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const m of readFileSync(file, 'utf-8').matchAll(specifier)) {
        const s = m[1] ?? m[2] ?? m[3];
        if (/^(@voice-kit\/|voice-kit\/)/.test(s)) throw new Error(`${relative(installed, file)} imports ${s}`);
        if (s.startsWith('.')) walk(resolve(dirname(file), s));
      }
    };
    walk(join(installed, entry));
  };

  // 3. 'voice-kit/composer' with the React the app brings: it renders, its stylesheet is packed, and its import
  // graph reaches no other voice-kit library.
  run('npm', ['install', '--no-audit', '--no-fund', 'react@19', 'react-dom@19'], app, { timeout: 480_000 });
  standsAlone('packages/composer/dist/index.js');
  writeFileSync(
    join(app, 'composer.mjs'),
    `
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { Composer, browserSpeech } from 'voice-kit/composer';

const html = renderToString(createElement(Composer, { mode: 'type', attach: true, onSend: () => true }));
if (!html.includes('bk-composer') || !html.includes('aria-label="Send"') || !html.includes('aria-label="Attach files"')) throw new Error('composer html: ' + html);
if (browserSpeech.supported()) throw new Error('node has no speech recogniser');
const css = createRequire(import.meta.url).resolve('voice-kit/composer/styles.css');
if (!existsSync(css)) throw new Error('styles.css is not packed');
console.log('voice-kit/composer renders');
`,
  );
  console.log(run('node', ['composer.mjs'], app).trim());

  // 4. 'voice-kit/speech' and 'voice-kit/speech/react': packed (packages/speech/dist), resolved by the exports map; the engine speaks a
  // text a sentence at a time into the honest fake, naming each sentence's language; the SpeakingBar renders with the app's React;
  // neither reaches another voice-kit library.
  for (const file of ['index.js', 'engine.js', 'lang.js', 'react.js', 'styles.css']) {
    if (!existsSync(join(installed, 'packages/speech/dist', file))) throw new Error(`packages/speech/dist/${file} is not packed`);
  }
  standsAlone('packages/speech/dist/index.js');
  standsAlone('packages/speech/dist/react.js');
  writeFileSync(
    join(app, 'speech.mjs'),
    `
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { installSpeech } from 'voice-kit/testing/speech';
import { speak, pause, resume, stop, getSpeech, isSupported } from 'voice-kit/speech';
import { SpeakingBar } from 'voice-kit/speech/react';

if (isSupported()) throw new Error('node has no speech synthesis');
globalThis.window = globalThis;
const fake = installSpeech(globalThis);
await new Promise((r) => setTimeout(r, 100)); // the fake lists its voices
if (!isSupported()) throw new Error('the fake is not seen');
speak('One. Two. \u039a\u03b1\u03bb\u03b7\u03bc\u03ad\u03c1\u03b1 \u03c3\u03b1\u03c2.', { key: 'smoke' });
if (getSpeech().count !== 3) throw new Error('not three sentences: ' + JSON.stringify(getSpeech()));
if (fake.log.length !== 3 || fake.log[2].lang !== 'el-GR' || fake.log[0].lang !== 'en-US') throw new Error('languages: ' + JSON.stringify(fake.log.map((e) => e.lang)));
if (!fake.log[2].voice) throw new Error('the Greek sentence has no voice');
pause();
if (getSpeech().status !== 'paused') throw new Error('not paused');
resume();
stop();
if (getSpeech().status !== 'idle') throw new Error('not stopped');
if (renderToString(createElement(SpeakingBar)) !== '') throw new Error('the bar shows with nothing speaking');
const css = createRequire(import.meta.url).resolve('voice-kit/speech/styles.css');
if (!existsSync(css)) throw new Error('styles.css is not packed');
fake.uninstall();
console.log('voice-kit/speech and voice-kit/speech/react work');
`,
  );
  console.log(run('node', ['speech.mjs'], app).trim());

  // 4b. 'voice-kit/talks': packed (packages/talks/dist), resolved by the exports map, stands alone; a talk is kept through an injected
  // grind in plain node, and a picture turn is sent once.
  for (const file of ['index.js', 'talk.js', 'store.js']) {
    if (!existsSync(join(installed, 'packages/talks/dist', file))) throw new Error(`packages/talks/dist/${file} is not packed`);
  }
  standsAlone('packages/talks/dist/index.js');
  writeFileSync(
    join(app, 'talks.mjs'),
    `
import { createMemoryStore, createTalks } from 'voice-kit/talks';

const store = createMemoryStore();
const sent = [];
const talks = createTalks({ store, send: async (request, files) => (sent.push({ request, files }), 'answer to ' + request.message) });
const talk = await talks.start({ title: 'Smoke' });
await talks.ask(talk.id, 'look at this', { pictures: [{ bytes: new Uint8Array([1, 2, 3]), mime: 'image/png', name: 'p.png' }] });
await talks.ask(talk.id, 'and now?');
const kept = await store.get(talk.id);
if (kept.turns.map((t) => t.role + ':' + t.text).join('|') !== 'user:look at this|assistant:answer to look at this|user:and now?|assistant:answer to and now?') throw new Error('turns: ' + JSON.stringify(kept.turns));
if (sent[0].files.length !== 1 || sent[0].request.pictures !== 1 || sent[1].files.length !== 0) throw new Error('pictures: ' + JSON.stringify(sent));
console.log('voice-kit/talks keeps a talk');
`,
  );
  console.log(run('node', ['talks.mjs'], app).trim());

  // 4b2. 'voice-kit/talks/grind': the grind side of the tutor client, in plain node: the instructions part, the answer fragment and
  // its examples, which the tutor client carries out as written; the plain files are packed beside dist.
  for (const file of ['grind/instructions.md', 'grind/answer.fragment.json', 'dist/grind.js']) {
    if (!existsSync(join(installed, 'packages/talks', file))) throw new Error(`packages/talks/${file} is not packed`);
  }
  standsAlone('packages/talks/dist/grind.js');
  writeFileSync(
    join(app, 'talks-grind.mjs'),
    `
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { checkArgs, createMemoryStore, createTutorClient, defineRegistry } from 'voice-kit/talks';
import { answerExamples, answerFragment, instructionsPart } from 'voice-kit/talks/grind';

if (new TextEncoder().encode(instructionsPart).length >= 6000) throw new Error('the instructions part is too big');
for (const word of ['asks', 'do', 'go', 'misses', 'catalogue']) if (!new RegExp('\\\\b' + word + '\\\\b').test(instructionsPart)) throw new Error('the instructions part does not name ' + word);
const plain = createRequire(import.meta.url).resolve('voice-kit/package.json').replace(/package\\.json$/, 'packages/talks/grind/');
if (readFileSync(plain + 'instructions.md', 'utf-8') !== instructionsPart) throw new Error('grind/instructions.md differs');
if (JSON.stringify(JSON.parse(readFileSync(plain + 'answer.fragment.json', 'utf-8'))) !== JSON.stringify(answerFragment)) throw new Error('grind/answer.fragment.json differs');
for (const [name, example] of Object.entries(answerExamples)) {
  const wrong = checkArgs(answerFragment, example);
  if (wrong) throw new Error('example ' + name + ': ' + wrong);
}
if (!checkArgs(answerFragment, { do: [{ args: {} }] })) throw new Error('a do without a name was accepted');

const ran = [];
const registry = defineRegistry({
  commands: [{ name: 'setTheme', tell: 'changes the theme', kind: 'free', args: { type: 'object', properties: { theme: { enum: ['dark', 'light'] } }, required: ['theme'] }, run: async (args) => (ran.push(args.theme), { said: 'ok' }) }],
  places: [{ name: 'chapter', tell: 'opens a chapter', args: { type: 'object', properties: { book: { type: 'string' }, chapter: { type: 'integer' } }, required: ['book', 'chapter'] }, open: async (args) => void ran.push(args.book + ' ' + args.chapter) }],
});
const tutor = createTutorClient({ store: createMemoryStore(), send: async () => ({ answer: 'Done.', ...answerExamples.doAndGo }), registry, screen: () => 'home' });
const talk = await tutor.start();
const turn = await tutor.ask(talk.id, 'dark please, and John 3');
if (ran.join('|') !== 'dark|John 3' || turn.misses.length !== 0 || turn.went?.name !== 'chapter') throw new Error('the example was not carried out: ' + JSON.stringify({ ran, misses: turn.misses }));
console.log('voice-kit/talks/grind teaches the protocol');
`,
  );
  console.log(run('node', ['talks-grind.mjs'], app).trim());

  // 4c. 'voice-kit/talks/dexie' (the app brings dexie) keeps the same talk in IndexedDB and reads it back after a reopen;
  // 'voice-kit/talks/react' renders TalkList with the app's React; the stylesheet is packed; neither reaches another voice-kit library.
  for (const file of ['dexieStore.js', 'TalkList.js', 'search.js', 'styles.css']) {
    if (!existsSync(join(installed, 'packages/talks/dist', file))) throw new Error(`packages/talks/dist/${file} is not packed`);
  }
  standsAlone('packages/talks/dist/dexieStore.js');
  standsAlone('packages/talks/dist/TalkList.js');
  run('npm', ['install', '--no-audit', '--no-fund', 'dexie@4', 'fake-indexeddb@6'], app, { timeout: 480_000 });
  writeFileSync(
    join(app, 'talks-device.mjs'),
    `
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { createTalks } from 'voice-kit/talks';
import { createDexieStore } from 'voice-kit/talks/dexie';
import { TalkList } from 'voice-kit/talks/react';

const open = () => createDexieStore({ name: 'smoke', indexedDB, IDBKeyRange });
const first = open();
const talks = createTalks({ store: first, send: async (request) => 'answer to ' + request.message });
const talk = await talks.start({ title: 'On the device' });
await talks.ask(talk.id, 'is this kept');
first.close();
const kept = await open().get(talk.id);
if (kept.turns.map((t) => t.text).join('|') !== 'is this kept|answer to is this kept') throw new Error('turns: ' + JSON.stringify(kept.turns));
const html = renderToString(createElement(TalkList, { store: first, onOpen: () => {} }));
if (!html.includes('bk-talklist') || !html.includes('aria-label="Search conversations"')) throw new Error('talk list html: ' + html);
const css = createRequire(import.meta.url).resolve('voice-kit/talks/styles.css');
if (!existsSync(css)) throw new Error('styles.css is not packed');
console.log('voice-kit/talks/dexie keeps a talk and voice-kit/talks/react renders');
process.exit(0);
`,
  );
  console.log(run('node', ['talks-device.mjs'], app).trim());

  // 4d. 'voice-kit/testing/talks': a scripted grind and a recording store drive the real loop.
  writeFileSync(
    join(app, 'talks-fakes.mjs'),
    `
import { createTalks } from 'voice-kit/talks';
import { createFakeGrind, createFakeTalkStore } from 'voice-kit/testing/talks';

const grind = createFakeGrind(['first answer']);
const store = createFakeTalkStore();
const talks = createTalks({ store, send: grind.send });
const talk = await talks.start();
await talks.ask(talk.id, 'hello');
if (grind.calls.length !== 1 || !store.calls.some((c) => c.method === 'append')) throw new Error('not recorded');
try {
  await talks.ask(talk.id, 'again');
  throw new Error('a used-up script answered');
} catch (e) {
  if (!/script is used up/.test(String(e.message))) throw e;
}
console.log('voice-kit/testing/talks drives a talk');
`,
  );
  console.log(run('node', ['talks-fakes.mjs'], app).trim());

  // 5. 'voice-kit/testing/speech' and 'voice-kit/testing/mic' in the vitest the app installs: packed (packages/testing/dist),
  // resolved by the exports map, and working under fake timers, by import and by the init-script strings for Playwright.
  for (const file of ['index.js', 'speech.js', 'mic.js', 'clips.js', 'talks.js']) {
    if (!existsSync(join(installed, 'packages/testing/dist', file))) throw new Error(`packages/testing/dist/${file} is not packed`);
  }
  // --legacy-peer-deps: npm 10.8 (the runner's) crashes ('Cannot read properties of null (reading edgesOut)') resolving vitest's
  // optional peer set once the registry's @vitest/browser-playwright 5.x joins it; vitest's own dependencies still install.
  run('npm', ['install', '--no-audit', '--no-fund', '--legacy-peer-deps', 'vitest@4'], app, { timeout: 480_000 });
  writeFileSync(
    join(app, 'testing.test.mjs'),
    `
import { afterEach, expect, it, vi } from 'vitest';
import { installSpeech, speechInitScript } from 'voice-kit/testing/speech';
import { clips, installMic, micInitScript } from 'voice-kit/testing/mic';

afterEach(() => vi.useRealTimers());

it('an honest utterance ends in the time its text sets', async () => {
  vi.useFakeTimers();
  const win = {};
  const fake = installSpeech(win);
  const events = [];
  const u = new win.SpeechSynthesisUtterance('Hello there world');
  u.onend = () => events.push('end@' + Date.now());
  const t0 = Date.now();
  win.speechSynthesis.speak(u);
  await vi.advanceTimersByTimeAsync(329);
  expect(events).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  expect(events).toEqual(['end@' + (t0 + 330)]);
  fake.uninstall();
});

it('an honest recogniser sends an interim result before the final one', async () => {
  vi.useFakeTimers();
  const win = {};
  const mic = installMic(win, { clip: clips.greek });
  const seen = [];
  const r = new win.webkitSpeechRecognition();
  r.interimResults = true;
  r.onresult = (e) => seen.push(e.results[0].isFinal);
  r.start();
  await vi.advanceTimersByTimeAsync(10000);
  expect(seen[0]).toBe(false);
  expect(seen.at(-1)).toBe(true);
  mic.uninstall();
});

it('the init scripts are the same fakes, from the built files', async () => {
  vi.useFakeTimers();
  (0, eval)(speechInitScript() + micInitScript({ denied: true }));
  const registry = globalThis.__bsvKitTesting;
  expect(typeof globalThis.speechSynthesis.speak).toBe('function');
  const denied = globalThis.navigator.mediaDevices.getUserMedia({ audio: true }).catch((e) => e.name);
  await vi.advanceTimersByTimeAsync(200);
  expect(await denied).toBe('NotAllowedError');
  registry.speech.uninstall();
  registry.mic.uninstall();
});
`,
  );
  run('npx', ['vitest', 'run'], app, { timeout: 240_000 });
  console.log('voice-kit/testing/speech and voice-kit/testing/mic run in vitest');
  console.log('consumer smoke test passed');
} catch (err) {
  console.error(String(err?.stderr ?? '') || err);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
