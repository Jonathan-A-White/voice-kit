# @voice-kit/forms

A form, as the tutor sees it. A person who would rather not fill in a form can let the tutor ask for each field in a talk and fill
the same form; the form is still his, and so is Send. This package is the shared half: what a form tells the tutor about itself, the
values an answer may fill, and the command that sends it, so **the Send button and the tutor call one path**. The sheet, the 'Let
the tutor do it' button and the talk are the app's.

No React, no DOM, no dependency. It imports only types from `voice-kit/talks` (a test says so).

## Install

By pinned commit (there is no registry); the repo's [README](../../README.md#install) names the commit to pin and has the npm 11
`allowScripts` note.

```bash
npm install github:Jonathan-A-White/voice-kit#<full commit SHA>
```

## A form adds the door in three steps

### 1. Describe the form

```ts
import type { FormSpec } from 'voice-kit/forms';

export const ASK_FOR_A_BOOK: FormSpec = {
  name: 'Ask for a book',
  fields: [
    { name: 'author', label: 'Author', required: true, kind: 'text', maxLength: 120 },
    { name: 'title', label: 'Title', hint: 'Required: as on the cover.', required: true, kind: 'text' },
    { name: 'format', label: 'Format', required: false, kind: 'choice', options: ['Paperback', 'Hardback', 'E-book'] },
    { name: 'cover', label: 'Add a photo of the cover', required: false, kind: 'pictures' },
    { name: 'link', label: 'Link', required: false, kind: 'link' },
  ],
};
```

Fields are in screen order. Kinds: `text`, `link`, `choice` (a select: the tutor answers with one of its `options`) and `pictures`
(only he can add those). At most 8 fields reach the request.

### 2. Make the command

```ts
import { defineRegistry } from 'voice-kit/talks';
import { argsOf, formCommand } from 'voice-kit/forms';

const askForBook = formCommand(ASK_FOR_A_BOOK, {
  name: 'askForBook',
  tell: 'Sends the Ask for a book form with the values given',
  send: async (values) => {
    await mySendOfTheForm(values); // the same function the Send button calls
    return { said: 'Asked for the book.' };
  },
});

export const registry = defineRegistry({ commands: [askForBook] });

// the form's own Send button passes the same args, through the same check:
const why = registry.refuses('askForBook', argsOf(ASK_FOR_A_BOOK, valuesOnScreen)); // undefined when it may go
```

`formCommand` returns a `Command` for the talks registry. Its `args` schema is built from the fields: one string property for each
field he types into (`maxLength` from the field, 1,200 when it has none; `enum` for a choice; pictures left out), `required` the
required fields, `additionalProperties: false`. The registry therefore refuses a missing required field, an over-long value or a
choice that is not among the options before `send` runs. `kind` is `'confirm'` unless given (`'undoable'` and `'free'` are the others;
`send` may return an `undo`). `offer` is the question put to him before a confirm command runs; the default is one line naming the
form and the required values: `Send Ask for a book: Wallace, Greek Grammar Beyond the Basics?`.

`argsOf(form, values)` gives the args the form's own Send passes: the fields with something in them, trimmed, empty optional ones left
out, pictures never.

### 3. Draw the panel, and put the form in the request

The panel (the button that starts the talk, the fields, Send) is the app's. The request carries the form as the tutor sees it:

```ts
import { FORM_START, applyValues, oneQuestion, requestFields, requiredFilled } from 'voice-kit/forms';

const request = {
  /* the app's own request fields */
  question: FORM_START, // what he says first, when he taps the button
  form: { name: ASK_FOR_A_BOOK.name, fields: requestFields(ASK_FOR_A_BOOK, values), command: 'askForBook' },
};
```

`requestFields(form, values)` gives each field's `name`, `label` (cut at 80), `hint` (cut at 120), `required`, `kind`, `value` (cut at
600) and, for a choice, its `options`. `command` is optional: give it when the app shows a Send button once every required field
holds something, and the tutor will say so (it still never sends).

When the answer comes back, three small helpers:

- `applyValues(form, answer.form_values)`: the `{ field, value }` pairs the form may take. A field the form does not have, a
  `pictures` field, an empty value and a choice not among the options are dropped; the rest are trimmed and cut to the field's limit.
  Put them in the fields.
- `requiredFilled(form, values)`: true when every required field holds something, so the app can show Send.
- `oneQuestion(answer.answer)`: the answer cut after its first question, for the model that asks and keeps talking.

## The grind fragment

`grind/helping-with-a-form.md` (packed with the package, under 3,000 bytes) is an instructions part for the app's grind: 'Helping
him fill in a form'. It teaches one question at a time, a `choice` answered with one of its options exactly, one rule for the
optional fields (only empty required fields are asked about, the first in screen order even when an optional field comes before it;
an optional field is never asked about, only named in the sentence that says the form is ready), a Send button that the tutor mentions but never presses, and that the tutor never sends. Include it in the grind's
instructions. The answer schema needs `form_values` (a list of `{ field, value }`, at most 8) and `form_ask` (a field name); they
are the app's, as the rest of its answer schema is.
