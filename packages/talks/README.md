# @voice-kit/talks

Multi-turn conversations, for every app that talks to a model. A **talk** is a list of turns, each with a role (`user` or
`assistant`), its words, the pictures that went with it, and the time. The **turn loop** takes what he said, builds the request
from the earlier turns, hands it to a **grind you inject** (`send(request, files) -> answer`: a model call, a mill, a fake),
and keeps both turns in order. A **store** keeps the talks; the one here is in memory, and the `TalkStore` interface is what any
other (IndexedDB, a server) meets. Beside the core are two entry points that need something of the app's: a **Dexie store**
that keeps talks on the device (`voice-kit/talks/dexie`) and a **TalkList** that shows them and opens one (`voice-kit/talks/react`).
The **tutor client** drives a talk through the app's registry of facts, commands and places, so the tutor can ask the app for what it
needs and do what he asks ([below](#the-tutor-client)).

The core has no framework and no dependency: no React, no DOM, nothing from the other voice-kit libraries (a test says so). It reaches no
network of its own: the grind you inject does that. The Composer's `useTalk` drives it as it is, with `onWords: (text) =>
talks.ask(id, text)`.

## Install

By pinned commit (there is no registry); the repo's [README](../../README.md#install) names the commit to pin and has the npm 11
`allowScripts` note.

```bash
npm install github:Jonathan-A-White/voice-kit#<full commit SHA>
```

## Use

```ts
import { createMemoryStore, createTalks } from 'voice-kit/talks';

const talks = createTalks({
  store: createMemoryStore(),
  // any grind: gets the request and the files, answers (a string here; see answerText for anything else)
  send: async (request, files) => callMyModel(request.message, request.history, files),
});

const talk = await talks.start({ title: 'Romans 8' });
const { answer } = await talks.ask(talk.id, 'What does adoption mean here?');
await talks.ask(talk.id, 'And in the next verse?'); // the request carries the first exchange as its history
```

### With the Composer's hold-to-talk

```tsx
import { useTalk } from 'voice-kit/composer';

const bar = useTalk(undefined, {
  onWords: (text, words) => {
    if (words.status === 'heard') void talks.ask(talk.id, text).then(({ answer }) => show(answer));
  },
});
```

## The request

The default request is `{ message, history, pictures? }`: `history` is the last `maxHistory` (10) turns as `{ role, text }`,
oldest first, and `pictures` is there only when files go with this message: how many. Give `maxRequestBytes` and the history is
cut to fit (`fitHistory`: the oldest long answer is clipped, then the oldest turn dropped; the message never).

For a grind with its own shape, give `buildRequest({ talk, message, turns, pictures }) -> request` and `answerText(answer) ->
string`; `send` is then typed by what you build and what it answers.

## Memory

The last ten turns are all a request carries, so something said at the beginning would be forgotten. A talk therefore keeps a
**memory** beside its turns: a few **facts** (short lines) and a **rolling summary**, kept by the store with the talk (a deleted
talk takes them too). The default request carries it as `memory: { facts, summary }`, only when there is something in it, and
`maxRequestBytes` cuts the history before it cuts the memory. The grind fills it: an answer that is an object with a
`memory_update` is read, and the update is applied for you.

```ts
const talks = createTalks({
  store: createMemoryStore(),
  send: async (request) => {
    // request.memory?.facts is what was said earlier and is no longer in request.history
    const reply = await callMyModel(request);
    return { text: reply.text, memory_update: reply.memory_update }; // e.g. { add: ['his dog is called Rex'], summary: 'Talked about pets.' }
  },
});
const talk = await talks.start();
await talks.ask(talk.id, 'My dog is called Rex.');
// ... thirty turns later the request still carries 'his dog is called Rex'

await talks.remember(talk.id, { remove: ['his dog is called Rex'] }); // by hand, the same rules
```

A `memory_update` is `{ add?: string[], remove?: string[], summary?: string }`. A fact is trimmed and kept once (case ignored), at most
300 characters, at most 40 to a talk; the summary replaces the old one and is cut at 1500 characters. What cannot be kept is
refused, never thrown: `ask` and `remember` return `{ applied, refused }` as lines to show or log. A malformed update changes
nothing. For a grind with another shape give `readMemory(answer) -> MemoryUpdate | undefined`; `memoryLimits` changes the limits;
a custom `buildRequest` gets `memory` in its input. Deciding *what* is worth keeping, and keeping the summary short, is the
grind's instruction, not this library's.

## Search

`searchTalks(store, query)` (or `talks.search(query)`) finds the talks with every word of the query in their title or in one of
their turns, ignoring case and accents. It reads the store through `list` and `get`, so it works for any store.

```ts
const hits = await talks.search('firstfruit');
// [{ id, title, updatedAt, matchCount: 2, matches: [{ in: 'turn', turn: 12, role: 'user', snippet: 'what is a firstfruit?' }] }]
```

A talk whose title matches comes first, then the talk last added to; `limit` caps the talks and `maxMatches` (3) the matches
shown for each (`matchCount` counts all). A blank query finds nothing.

## Pictures

`ask(id, message, { pictures })` sends up to four JPEG, PNG or WebP pictures (`{ bytes, mime, name }`) with the message as `files`,
and keeps them on his turn. They are **sent once**: the history of later requests is text only. To send a kept picture again, name
its turn: `ask(id, 'what is at the top of the first one?', { resend: [0] })` sends the pictures of turn 0, then any new ones. With
pictures and no words the message is `PICTURE_ONLY_QUESTION`. Too many, another type, or a turn with nothing to resend
rejects with `TalkInputError` before anything is sent. (Shrinking a picture is the app's: `maxPictures` and `pictureMimes` say what
is allowed.) `dataUrlOf(bytes, mime)` draws a kept one.

## Failures and order

A grind that throws, or a wrong input, keeps nothing and rejects the `ask`; the talk goes on from where it was. Asks on one talk wait
for the one before, so turns asked at once are kept in the order asked. Times come from `now` (`Date.now` unless given): his turn is
stamped when the ask starts, the answer's when it arrives.

## The tutor client

The tutor should be able to get from the app what it needs for its reply, and to do through the app what he asks for: read his
plan, change a setting, open a screen. The app lists what it lets the tutor know, do and open in a **registry**, and the **tutor
client** drives a talk through it. It knows no app: each app brings its own registry.

```ts
import { createMemoryStore, createTutorClient, defineRegistry } from 'voice-kit/talks';

const registry = defineRegistry({
  facts: [
    { name: 'where', tell: 'the screen he is on', core: true, read: async () => currentScreen() },
    { name: 'todaysDrill', tell: "today's drill: the words and how far he got", read: () => drills.today() },
  ],
  commands: [
    { name: 'markDone', tell: "marks today's drill done", kind: 'free', run: async () => ({ said: 'Marked done.' }) },
    {
      name: 'setTheme',
      tell: 'changes the theme',
      kind: 'undoable',
      args: { type: 'object', properties: { theme: { enum: ['dark', 'light'] } }, required: ['theme'] },
      run: async (args) => {
        const { theme } = args as { theme: 'dark' | 'light' }; // checked against `args` before run is called
        const before = await settings.theme();
        await settings.setTheme(theme);
        return { said: `Theme: ${theme}`, undo: () => settings.setTheme(before) };
      },
    },
    { name: 'resetProgress', tell: 'forgets all his progress', kind: 'confirm', offer: () => 'Reset all your progress?', run: resetProgress },
  ],
  places: [{ name: 'chapter', tell: 'opens a chapter', args: { type: 'object', properties: { book: { type: 'string' }, chapter: { type: 'integer' } }, required: ['book', 'chapter'] }, open: openChapter }],
});

const tutor = createTutorClient({
  store: createMemoryStore(), // or the Dexie store: it keeps the record and the up-front lists too
  send: (request, files) => callMyModel(request, files),
  registry,
  screen: () => currentScreen(),
  budgetBytes: 24_000,
  onGo: (went) => history.pushState({ went }, ''), // so Back returns to the talk
});
const talk = await tutor.start();
const turn = await tutor.ask(talk.id, "what's on my drill today?");
// turn.answer, turn.done ([{ name, kind, said, undo? }]), turn.pending ([{ name, said, confirm() }]), turn.went, turn.misses
```

**The registry.** `defineRegistry({ facts, commands, places })`; a name is used once across all three (a second throws).

- A **fact** `{ name, tell, read(), core? }`: `tell` is one line for the tutor; a `core` fact is read for every request.
- A **command** `{ name, tell, args?, kind, run(args), offer? }`: `args` is a small JSON schema (`type`, `properties`, `required`,
  `additionalProperties`, `items`, `enum`, `minimum`/`maximum`, `minLength`/`maxLength`); without one it takes no args. `run`
  resolves to `{ said, undo? }`. `kind` is `'free'` (runs at once), `'undoable'` (runs, and its `undo` is handed to the app) or
  `'confirm'` (not run: the app gets `{ said, confirm() }`, `said` being `offer(args)` or the tell line, and calls `confirm()` when
  he says yes).
- A **place** `{ name, tell, args?, open(args) }`.

`registry.catalogue()` lists every name as `{ name, is: 'fact' | 'command' | 'place', kind?, core?, tell, args? }`, sorted by name,
the same every time. A call is checked before anything runs: `registry.run(name, args)` and `registry.open(name, args)` resolve to
`{ ok: true, ... }` or `{ ok: false, why }` ('args.theme must be one of "dark", "light"'), and a refused call never runs.
`checkArgs(schema, value)` is the check on its own.

**The request** is the app's own fields (the default request, or what `buildRequest(input)` makes) with two more:

- `facts`: `{ name: value }` for every core fact and every fact on the screen's **up-front list** (`store.upFront(screen)`, set
  with `store.setUpFront(screen, names)`; empty means the core facts only). A fact whose read fails is left out and recorded as a miss.
- `catalogue`: the registry's catalogue.

Over `budgetBytes` the tell lines of the non-core entries are cut first (from the end of the catalogue), then the newest
non-core facts are dropped (the last of the up-front list first; the name stays in the catalogue, so the tutor can ask for it).
The app's fields and the core facts are never cut. `tutor.buildRequest(turn, fields)` builds one for an app that sends it itself.

**The answer.** The client reads four fields; every other field is the app's.

- `asks: string[]`: facts it wants before it answers. Each one the registry has is read and the request goes again, in the same
  turn, with `asked: { name: value }`; a name it does not have is not sent back and is recorded as a miss. **Two rounds at
  most**: the second answer is the one kept and returned, even if it asks again (those asks are recorded as misses).
- `do: [{ name, args }]`: commands, run in order as their kind says.
- `go: { name, args }`: a place, opened; then `onGo({ name, args })` tells the app.
- `misses: [{ wanted, why }]`: what it wanted that the app has no fact, command or place for.

An unknown name, refused args or a run that throws is a **miss**, never thrown. Only the answer that stands is carried out.
`tutor.takeAnswer(answer, turn)` carries out `do`, `go` and `misses` of an answer the app got some other way.

**The record.** Every turn, ask-back and miss is noted in the store as `{ at, screen, kind: 'turn' | 'ask' | 'miss' | 'weights', name,
turn, why?, names? }` (`turn` is his turn's place in the talk) and read back with `store.record(screen?)`, oldest first: what the
tutor needed on each screen, for tuning the up-front lists. A `turn` line (no name) is written first for each turn of `ask()` and
each `buildRequest()`, so ask-backs can be counted per turn; a `weights` line is an applied list (below).

### What is carried up front, and how it learns

Which facts to read for every request is a trade: too few and the tutor asks back (an extra round, a slower answer), too many and
every request is heavy. The client does not guess. It **counts**, per screen, how often a fact was asked back, and carries up front
the ones that were asked back often lately. No model is involved; the whole of it is counts over the record above.

- **The list.** `tutor.upFront(screen)` is the core facts, then the facts asked back **at least N times in the last M turns on that
  screen**, the most asked back first (a name that is not a fact, or is core, is never listed). The defaults are N = 2 and
  M = 50 and are provisional: `createTutorClient({ ..., learn: { askBacks: 3, turns: 100 } })` moves either. Every request reads
  this list.
- **Applying a list.** `await tutor.applyWeights({ reader: ['todaysDrill'], home: [] }, 'grist' | 'app', at?)` sets the lists for
  those screens (`at` is now unless given) and records each with its date and source in a `weights` line. From then on an applied
  list stands over the counted one (an empty list means the core facts only). It returns, for each screen, what was applied and the
  `ignored` names (not a fact, or core). Whoever sets lists by hand with `store.setUpFront` is read the same way when nothing was applied.
- **Did it help?** `tutor.rate(screen, since, until?)` is the **ask-backs per 100 turns** on a screen from `since` (ms since the
  epoch) to `until` (undefined when there were no turns in that time). `tutor.change(screen)` gives it for the latest applied list:
  `{ at, source, before, after }`, `before` being the time under the list applied before it (else all of the record up to it). If
  the lists help, `after` is lower than `before`.
- **The statistics.** `tutor.stats(screen?)` is `{ screen: { turns, askBacks: { name: n }, misses: { wanted: n } } }` over all of the record.
- **The nightly report.** `tutor.weightsReport(since)`, `since` being the time of the last run of whatever tunes the weights, is
  what that run reads:

  ```ts
  const report = await tutor.weightsReport(lastRunAt);
  if (report.changed) {
    // report.screens.reader = { turns, windowTurns, counts: { todaysDrill: 3 }, upFront: ['where', 'todaysDrill'],
    //   applied?: { at, source, names }, rate: { overall, before?, after? } }
    // report.misses = [{ screen, name, count, why }]   (misses newer than lastRunAt)
    await tutor.applyWeights(listsItChose, 'grist');
  }
  ```

  `changed` is false when no ask-back, miss or applied list is newer than `since`: then the run has nothing to ask. (Turns alone do
  not change it.) The counts are those of the window, the ones the counted list is made of.

A record from before 0.4.0 has no `turn` lines, so its screens count all their ask-backs until they have turns of their own.

## The grind side

The tutor client speaks one protocol with every app (the request's `facts` and `catalogue`, the answer's `asks`, `do`, `go`, `misses`
and `said`), so the words that teach it to the model live once, here, and each app's grind includes them. `voice-kit/talks/grind`
gives three things and imports nothing, so a Node script (the app's grind build) can use it:

- `instructionsPart`: markdown, under 6,000 bytes (`INSTRUCTIONS_MAX_BYTES`), to concatenate into the grind's instructions. It teaches
  the catalogue's format (`{ name, is, kind?, core?, tell?, args? }`, and that a missing `tell` only means the request was cut), when
  to ask back rather than guess (once, for everything it needs, only a `fact` of the catalogue), that `do` and `go` go only through
  the catalogue with the args as described, what `free`, `undoable` and `confirm` do, a miss when something is wanted that the
  catalogue lacks (never an invented name), and one line in `said` on what it did.
- `answerFragment`: a JSON schema (draft 2020-12) of `asks`, `do`, `go`, `misses` and `said`, all optional, a `do` or a `go` needing
  its `name`. Merge its `properties` into the app's answer schema; the app's own fields (`answer`, its words) stay its own.
- `answerExamples`: one answer of each kind (`asks`, `doAndGo`, `miss`, `sayOnly`), for the grind's examples and for a smoke test;
  each validates against the fragment and the client carries each out as written.

```ts
import { answerExamples, answerFragment, instructionsPart } from 'voice-kit/talks/grind';

// in the app's grind build (a Node script)
const grind = {
  instructions: [myInstructions, instructionsPart].join('\n\n'),
  answerSchema: {
    ...mySchema,
    properties: { ...mySchema.properties, ...answerFragment.properties },
  },
  examples: [{ input: myRequestExample, answer: { answer: 'Done.', ...answerExamples.doAndGo } }],
};
```

The same text and JSON are in the package as plain files, `grind/instructions.md` and `grind/answer.fragment.json`, for a build
that reads files (a test holds them equal to the exports). Both describe the protocol as the client carries it out: if the client's
fields change, they change with it, in the same release.

## On the device: the Dexie store

`createDexieStore()` from `voice-kit/talks/dexie` is a `TalkStore` kept in IndexedDB through Dexie, so talks outlive the page. The
app installs `dexie` (version 4 or later; an optional peer of this package). It has a database of its own with a row per talk and a
row per turn, so a list reads no turns; pictures and memory are kept with the talk and go when it goes. It passes the same contract
tests as the in-memory store.

```ts
import { createTalks } from 'voice-kit/talks';
import { createDexieStore } from 'voice-kit/talks/dexie';

const store = createDexieStore({ name: 'my-app-talks' }); // 'voice-kit-talks' unless given
const talks = createTalks({ store, send: callMyGrind });
// ... the talks are still there after a reload; store.close() closes the connection
```

In a test, `fake-indexeddb` stands in for the browser: `createDexieStore({ name, indexedDB, IDBKeyRange })` with both from
`'fake-indexeddb'` (or `import 'fake-indexeddb/auto'` before the first store is made).

## On screen: TalkList

`TalkList` from `voice-kit/talks/react` lists the talks in a store, the one added to last first, with a search field over their
titles and turns (`searchTalks`, so a found talk shows the line that matched). A tap calls `onOpen` with the talk's id: what opening
looks like (a sheet, a route, a Composer over the talk) is the app's.

```tsx
import { TalkList } from 'voice-kit/talks/react';
import 'voice-kit/talks/styles.css'; // optional: or style the bk-talklist__* classes yourself

<TalkList store={store} onOpen={(id) => openTalk(id)} />;
```

Props: `store`, `onOpen(id)`; `limit`; `refreshKey` (change it to read the store again after a talk is added to, renamed or
removed); `labels` (the words it shows, in the app's language: `placeholder`, `searchLabel`, `listLabel`, `untitled`, `empty`,
`noMatches`, `failed`, `turns(count)`); `formatTime(ms)`; `className`. The theme is the `--bk-talklist-*` custom properties named at
the top of `styles.css`.

## The store

`TalkStore`: `create`, `get`, `list` (summaries, last added to first), `append`, `rename`, `setMemory`, `remove`. Every method is
async and what comes out is a copy. `TutorStore`, which the tutor client needs beside it: `upFront(screen)`, `setUpFront(screen,
names)`, `note(records)`, `record(screen?)`. `tests/storeContract.ts` holds a contract any store must keep; the in-memory store, the
Dexie store and the fake of `voice-kit/testing/talks` pass it, and all three are both.
A talk's `memory` (`{ facts, summary }`) is kept with it (`setMemory`) and goes when it goes.
