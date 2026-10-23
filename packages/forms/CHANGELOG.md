# Changelog: @voice-kit/forms

Newest first. Breaking changes come first in a release, each with its migration in one sentence.

## 0.1.1 (2026-10-23)

- Fixed (mw-63u3pr.1): `grind/helping-with-a-form.md` said two things about optional fields once the required ones were held ('then
  optional ones' and 'leave `form_ask` out'), and a tutor given both asked about an optional field when the form was ready. It now
  says one thing, in one bullet: an optional field is asked about (once at most) only while a required one is still empty and he has
  answered past it; once every required field holds something the turn says the form is ready, leaves `form_ask` out, and may name
  the empty optional fields in that same sentence. An app that copies the fragment takes the new text. No change to the code.

## 0.1.0 (2026-10-23, not yet tagged)

- New (mw-o7cts8.1): `voice-kit/forms` (`@voice-kit/forms`), a form as the tutor sees it, lifted from Lampas's form helper with a
  fourth field kind. `FormSpec` (`name`, `fields`: text, link, choice with `options`, and pictures); `requestFields(form, values)`,
  the `fields` of the request's `form` (label cut at 80, hint at 120, value at 600, at most 8 fields, a choice's `options`);
  `applyValues(form, given)`, the values of an answer the form may take (a field the form has, never pictures, trimmed and cut, an
  empty value or a choice not among the options ignored); `requiredFilled`, `oneQuestion` and `FORM_START`.
- New: `formCommand(form, { name, tell, kind?, send, offer? })`, a `Command` for `@voice-kit/talks`' registry whose args schema is
  built from the fields, so the form's own Send button (`argsOf(form, values)`) and the tutor's `do` are one path. `confirm` by
  default, with an offer that names the form and the required values.
- New: `grind/helping-with-a-form.md`, the grind part 'Helping him fill in a form'.
- Imports only types from `voice-kit/talks`: no React, no DOM, no dependency.
