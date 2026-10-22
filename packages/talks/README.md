# @voice-kit/talks

Multi-turn conversations, for every app that talks to a model. A **talk** is a list of turns, each with a role (`user` or
`assistant`), its words, the pictures that went with it, and the time. The **turn loop** takes what he said, builds the request
from the earlier turns, hands it to a **grind you inject** (`send(request, files) -> answer`: a model call, a mill, a fake),
and keeps both turns in order. A **store** keeps the talks; the one here is in memory, and the `TalkStore` interface is what any
other (IndexedDB, a server) meets.

It has no framework and no dependency: no React, no DOM, nothing from the other voice-kit libraries (a test says so). It reaches no
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

## The store

`TalkStore`: `create`, `get`, `list` (summaries, last added to first), `append`, `rename`, `setMemory`, `remove`. Every method is
async and what comes out is a copy. `tests/store.test.ts` holds a contract any store must keep; the in-memory store passes it.
A talk's `memory` (`{ facts, summary }`) is kept with it and goes when it goes; what fills it and folds it into a request is a
later step of this library.
