# Changelog: @voice-kit/talks

Newest first. Breaking changes come first in a release, each with its migration in one sentence.

## 0.10.0 (2026-10-23, not yet tagged)

- New (mw-o480n1.5): the app's own look in `TalkList`. `renderRow(row, open)` draws the whole row inside the kit's `<li>` (`row` is a
  `TalkListRow`: `id`, `title`, `line`, `updatedAt`, `turnCount?`, `summary` (the `TalkSummary`) and, when searching, `hit` (the
  `TalkHit`)); `filter(row)` hides rows (they do not count toward the empty note); `search` passes `searchTalks` options through
  (`places`, `fold`, `snippet`, `maxMatches`; the list's `limit` goes with them); `renderNote(kind, text)` draws the app's note for
  `'empty'`, `'noMatches'` and `'failed'`; `classNames` adds classes to `root`, `searchWrap`, `search`, `note`, `list`, `item` and
  `row`. `TalkList` takes a `TalkReader<F>` and is generic in `F`. Exports `TalkListRow` and `TalkListPart`. Without the new props the
  list draws as before, with one new element: the search field now sits in `<div class="bk-talklist__searchwrap">` (styled only
  `display: block`), so a stylesheet that selected `.bk-talklist > input` must select `.bk-talklist__search`. Additive.

## 0.9.0 (2026-10-23, not yet tagged)

- New (mw-o480n1.4): a pluggable search. `SearchOptions<F>` gains `places(talk)` (the `SearchPlace[]` searched, in order, `{ in:
  'title' | 'turn', turn?, role?, text }`: the title then each turn unless given, so an app may make one place of a question and its
  answer), `fold(text)` (how the query and the texts are folded: `foldText`, case and accents, unless given; a fold must keep the
  text's length or come with its own `snippet`) and `snippet(text, at, term)` (the line a turn match carries: `defaultSnippet`, 30
  characters before and 60 after, unless given). `maxMatches` may be `Infinity`. `searchTalks` reads through a `TalkReader<F>`.
  Exports `SearchPlace`, `foldText` and `defaultSnippet`; `talks.search` passes the options through. With none given the results are
  as before. Additive.

## 0.8.0 (2026-10-23, not yet tagged)

- New (mw-o480n1.3): app fields on a turn. `Turn<F>` gains `fields?: F` (what the app keeps with a turn beyond the kit's own; the kit
  reads nothing in it), `TalkSummary<F>` gains `fields?: F` (the app's own summary of a talk: a store of this library never fills it, a
  reader an app writes over its own tables may), and `Talk<F>`, `TalkStore<F>`, `createMemoryStore<F>()` and `createDexieStore<F>()`
  carry the type. `F` defaults to `Record<string, unknown>`, so an app that gives no fields writes the types as it always did. The
  in-memory and Dexie stores keep a turn's fields by copy (a structured clone where there is one, else a JSON round trip), on `append`
  and on `get`; a turn kept without fields reads back without the key. Dexie keeps them in the turn's row with no index, so the schema
  stays at version 2 and a database made before reads as it did.
- New: `TalkReader<F>`, `Pick<TalkStore<F>, 'list' | 'get'>`: what a list and a search read through. `searchTalks` and `TalkList` now
  take one (any `TalkStore` is one), so an app whose talks live in its own tables gives a reader without pretending to create or rename.
  Additive.

## 0.7.0 (2026-10-23, not yet tagged)

- New (mw-o480n1.2): notes an app keeps by name, beside the per-talk memory (which is unchanged). `applyNoteUpdates(updates, notes,
  { when?, warn? })` applies a list of `NoteUpdate`s (`{ name, append | replace | remove, directed? }`) over the app's `NoteStore`
  (`{ nameOf, append, replace, remove }`, each write answering `'saved'` or the reason it was not): an append goes through, a replace
  or remove only when `directed`, a name `nameOf` refuses is refused, and a write that answers a reason or throws is refused, never
  thrown. It answers `{ applied, refused }` as lines: `Added to X`, `Replaced X`, `Removed X`, `Did not change X: why`; each refused
  line also goes to `warn`. `isNoteUpdate(value, limits)` and `readNoteUpdates(answer, limits)` (an answer's `memory_update` list,
  or `undefined` when any entry is malformed) take `NoteLimits { nameMax, appendMax, replaceMax }`. Additive.

## 0.6.0 (2026-10-23, not yet tagged)

- New (mw-o480n1.1): an app's own cutting steps. `fitRequest(request, steps, { maxBytes, extraBytes?, sizeOf? })` runs an ordered list
  of `Cut`s (`(request) => request | null`), each taken again while the request is over budget until it returns `null`, and stops as
  soon as the request fits; `extraBytes` weighs with the request (a header), `sizeOf` replaces `jsonBytes`. `fitHistory` is now
  `fitRequest(request, [clipLongAnswers, dropOldestTurn], { maxBytes })` and behaves as before. Also exported: `clipLongAnswers`,
  `dropOldestTurn`, `clipText`, `jsonBytes`, `CLIPPED_CHARS` (240), `CLIP_MARK` and the types `Cut` and `FitBudget`. Additive.

## 0.5.0 (2026-10-23, not yet tagged)

- New (mw-t3xu9a.3): `voice-kit/talks/grind` (`@voice-kit/talks/grind`), the grind side of the tutor client, in plain node with no
  import. `instructionsPart` is the markdown that teaches the protocol (the catalogue's format, when to ask back, `do` and `go` only
  through the catalogue, the three command kinds, a miss for what the catalogue lacks, one line of `said`), under 6,000 bytes;
  `answerFragment` is the JSON schema of `asks`, `do`, `go`, `misses` and `said` for an app's answer schema; `answerExamples` is
  one answer of each kind. The same text and JSON ship as `grind/instructions.md` and `grind/answer.fragment.json`. Additive.

## 0.4.0 (2026-10-23, not yet tagged)

- New (mw-t3xu9a.2): the tutor client learns what to carry up front, by counting. `tutor.upFront(screen)` is the core facts plus the
  facts asked back at least N times in the last M turns on that screen (N = 2, M = 50, provisional; `createTutorClient({ learn: {
  askBacks, turns } })`), and every request reads it. `applyWeights({ screen: names[] }, 'grist' | 'app', at?)` records each list
  with its date and source and makes it stand over the counted one; `rate(screen, since, until?)` is ask-backs per 100 turns and
  `change(screen)` the rate before and after the latest applied list; `stats(screen?)` counts turns, ask-backs and misses per
  screen; `weightsReport(since)` is what the nightly grist reads: the counts, the misses newer than `since`, the current lists, the
  rates, and `changed` (false when no ask-back, miss or applied list is newer than `since`). Also `createStats` and the types.
- Changed: the tutor record has two new kinds, `'turn'` (a line for each turn of `ask()` and each `buildRequest()`, written first, so
  ask-backs can be counted per turn) and `'weights'` (an applied list: the source in `name`, the list in the new `names`). A reader
  of `store.record()` that took every line for an ask-back or a miss must now look at `kind`. The Dexie database keeps them in the same
  table (no new version); a record from before has no turn lines.

## 0.3.0 (2026-10-23, not yet tagged)

- Changed: `createMemoryStore()` and `createDexieStore()` now return a `TalkStore & TutorStore`; the Dexie database goes to
  version 2 (two new tables, the talks kept as they were). A store an app wrote itself still meets `TalkStore` as it is; it needs
  the four `TutorStore` methods only to be given to the tutor client.
- New (mw-t3xu9a.1): the tutor client. `defineRegistry({ facts, commands, places })` lists what an app lets the tutor know (a fact
  `{ name, tell, read(), core? }`), do (a command `{ name, tell, args, kind: 'free' | 'undoable' | 'confirm', run(args) }`, its args
  checked against a small JSON schema before it runs) and open (a place `{ name, tell, args?, open(args) }`); a name is used once,
  and `catalogue()` lists them sorted. `createTutorClient({ store, send, registry, screen, budgetBytes?, buildRequest?, onGo? })`
  drives a talk through it: each request carries `facts` (the core facts and the screen's up-front list) and `catalogue`, cut to
  `budgetBytes` (non-core tell lines first, then the newest non-core facts; the app's fields never); an answer's `asks` are read
  and sent back as `asked` in a follow-up round (two rounds a turn at most), `do` runs commands as their kind says (a confirm one
  is handed to the app to confirm), `go` opens a place and tells the app (`onGo`), and `misses` are recorded. A refused call is a
  miss, never thrown.
- New (mw-t3xu9a.1): `TutorStore`: each screen's up-front list (`upFront`, `setUpFront`) and the record of every ask-back and
  miss (`note`, `record(screen?)`, lines `{ at, screen, kind: 'ask' | 'miss', name, turn, why? }`), kept by the in-memory store, the
  Dexie store and the fake of `@voice-kit/testing` 0.3.0, held to the same contract (`tests/storeContract.ts`).

## 0.2.0 (2026-10-22, not yet tagged)

- New (mw-79en7t.31): `createDexieStore({ name?, newId?, now? })` from `voice-kit/talks/dexie`: a `TalkStore` kept on the device in
  IndexedDB through Dexie, one row per talk (with its turn count and first words, so a list reads no turns) and one per turn, pictures
  and memory included. It passes the same contract tests as the in-memory store (`tests/storeContract.ts`, run over both). Carved from
  Lampas's `src/data/repositories/talks.ts` without the Bible parts. `dexie` (>=4) is an optional peer of the package.
- New (mw-79en7t.31): `TalkList` from `voice-kit/talks/react`: a searchable list of the talks in a store, newest first, that tells
  the app which talk was tapped (`onOpen(id)`). A search reads titles and turns through `searchTalks` and shows the matching line.
  `refreshKey`, `limit`, `labels` and `formatTime` props; styled by `voice-kit/talks/styles.css` (`--bk-talklist-*` properties) or
  by the `bk-talklist__*` classes. Carved from Lampas's `src/Conversations.tsx`. `react` (>=18) is an optional peer.
- The core, `voice-kit/talks`, is unchanged and still imports nothing; the two new files are their own entry points, so an app that
  wants neither pays for neither.
- The fakes for a test of an app that uses talks are in `@voice-kit/testing` 0.2.0 (`voice-kit/testing/talks`).

## 0.1.0 (2026-10-22, not yet tagged)

- New (mw-79en7t.29): the library. A `Talk` of turns (`{ role, text, pictures?, at }`) with a memory slot; `createTalks({ store, send })`
  with `start()` and `ask()`, the turn loop over an injected grind (`send(request, files) -> answer`, any grind); picture turns
  kept with the turn and sent once, again only when `ask` names the turn in `resend`; `fitHistory`; the `TalkStore` interface and
  `createMemoryStore()`. Carved from Lampas's `src/data/repositories/talks.ts`, `src/services/talk.ts` and `src/talk/pictures.ts`,
  without the Bible and Greek parts. It imports nothing, so it works with the Composer's `useTalk` as it is.
- New (mw-79en7t.30): memory. A talk keeps facts and a rolling summary beside its turns, and the default request carries them as
  `memory` (only when there is something), so a thing said at turn 1 is still in the request at turn 30. An answer's `memory_update`
  (`{ add?, remove?, summary? }`) is applied with limits (40 facts, 300 and 1500 characters) and `talks.remember(id, update)` does the
  same by hand; `ask` returns what was applied and refused. `readMemory` and `memoryLimits` options. Carved from Lampas's
  `src/talk/memoryUpdate.ts` and `src/data/repositories/memory.ts` without the Bible naming scheme, the index and the Greek offer.
- New (mw-79en7t.30): `searchTalks(store, query)` and `talks.search(query)`: the talks with every word of the query in a title or
  a turn, with where and a snippet; case and accents ignored.
