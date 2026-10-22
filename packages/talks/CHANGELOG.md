# Changelog: @voice-kit/talks

Newest first. Breaking changes come first in a release, each with its migration in one sentence.

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
- Not yet here (next steps of the library): the Dexie store, a list to open a talk from, and the fakes in `@voice-kit/testing`.
