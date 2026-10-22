# Changelog: @voice-kit/talks

Newest first. Breaking changes come first in a release, each with its migration in one sentence.

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
