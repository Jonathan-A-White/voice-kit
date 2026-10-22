# Changelog: @voice-kit/talks

Newest first. Breaking changes come first in a release, each with its migration in one sentence.

## 0.1.0 (2026-10-22, not yet tagged)

- New (mw-79en7t.29): the library. A `Talk` of turns (`{ role, text, pictures?, at }`) with a memory slot; `createTalks({ store, send })`
  with `start()` and `ask()`, the turn loop over an injected grind (`send(request, files) -> answer`, any grind); picture turns
  kept with the turn and sent once, again only when `ask` names the turn in `resend`; `fitHistory`; the `TalkStore` interface and
  `createMemoryStore()`. Carved from Lampas's `src/data/repositories/talks.ts`, `src/services/talk.ts` and `src/talk/pictures.ts`,
  without the Bible and Greek parts. It imports nothing, so it works with the Composer's `useTalk` as it is.
- Not yet here (next steps of the library): the memory of a talk folded into each request, search over titles and turns, the Dexie
  store, a list to open a talk from, and the fakes in `@voice-kit/testing`.
