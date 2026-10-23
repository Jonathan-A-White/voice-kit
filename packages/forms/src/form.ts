// form.ts (mw-o7cts8.1) — a form as the tutor sees it: what it tells the tutor about itself, which fields an answer may fill, and when it may
// be sent. Lifted from Lampas's formHelper, with the choice kind added. A form that offers the tutor describes itself as a FormSpec; nothing
// here knows a particular form, and nothing here draws one.

/** The kinds of field the tutor is told about: text (any length), a link, a choice among options, and pictures (only he can add those). */
export type FormFieldKind = 'text' | 'link' | 'choice' | 'pictures';

export interface FormField {
  /** the field's key, which the tutor's answer names: 'author', 'format' */
  name: string;
  /** what the form calls it on screen: 'Who to credit' */
  label: string;
  /** the line under it, if the form has one */
  hint?: string;
  required: boolean;
  kind: FormFieldKind;
  /** the longest text the field takes (not for pictures) */
  maxLength?: number;
  /** for a choice: what it can be, and the tutor answers with one of them exactly */
  options?: readonly string[];
}

/** A form as the tutor sees it: its name and its fields, in the order they are on screen. */
export interface FormSpec {
  name: string;
  fields: readonly FormField[];
}

/** One field of the request: the form's field and what it holds now (for pictures, a count such as '2 pictures added', or ''). */
export interface FormFieldState {
  name: string;
  label: string;
  hint?: string;
  required: boolean;
  kind: FormFieldKind;
  value: string;
  /** a choice's options */
  options?: readonly string[];
}

/** What the request carries of the form, as `form` in the app's request: its fields and, once the app has a Send button for it, the
 * name of the command that sends it. */
export interface FormRequest {
  name: string;
  fields: FormFieldState[];
  command?: string;
}

/** What an answer says about the form: a value for a field. */
export interface FormValue {
  field: string;
  value: string;
}

/** The longest value of one field in the request; a longer text is cut for the request only. */
export const FORM_FIELD_MAX = 600;
/** The most fields a form may have in the request. */
export const MAX_FORM_FIELDS = 8;
/** The longest label and hint in the request. */
export const LABEL_MAX = 80;
export const HINT_MAX = 120;
/** The longest form name in the request. */
export const FORM_NAME_MAX = 40;
/** The longest value of a field in an answer, for a field with no limit of its own. */
export const FORM_VALUE_MAX = 1200;

/** What he says first, when he taps the button. */
export const FORM_START = 'Help me fill this in.';

const cut = (text: string, max: number): string => (text.length <= max ? text : text.slice(0, max - 1).trimEnd() + '…');

/** The fields of `form` with what `values` holds (by field name; a missing one is empty): the `fields` of the request's `form`. */
export function requestFields(form: FormSpec, values: Readonly<Record<string, string>>): FormFieldState[] {
  return form.fields.slice(0, MAX_FORM_FIELDS).map((f) => ({
    name: f.name,
    label: cut(f.label, LABEL_MAX),
    ...(f.hint ? { hint: cut(f.hint, HINT_MAX) } : {}),
    required: f.required,
    kind: f.kind,
    value: cut(values[f.name] ?? '', FORM_FIELD_MAX),
    ...(f.kind === 'choice' && f.options ? { options: [...f.options] } : {}),
  }));
}

/** The values of an answer the form may take: those for a field the form has that he types into, trimmed and cut to the field's limit. A
 * field the form does not have, a pictures field, an empty value and a choice value that is not one of the options are ignored. */
export function applyValues(form: FormSpec, given: readonly FormValue[] | undefined): FormValue[] {
  const filled: FormValue[] = [];
  for (const { field, value } of given ?? []) {
    const spec = form.fields.find((f) => f.name === field);
    if (!spec || spec.kind === 'pictures' || typeof value !== 'string') continue;
    const text = value.trim().slice(0, spec.maxLength ?? FORM_VALUE_MAX);
    if (!text) continue;
    if (spec.kind === 'choice' && !spec.options?.includes(text)) continue;
    filled.push({ field, value: text });
  }
  return filled;
}

/** Whether every required field of `form` holds something (a pictures field holds something when `values` says so). */
export const requiredFilled = (form: FormSpec, values: Readonly<Record<string, string>>): boolean =>
  form.fields.every((f) => !f.required || (values[f.name] ?? '').trim() !== '');

/** The tutor's answer cut after its first question: the grind is told to ask one question, and now and then the model asks it and keeps
 * talking ('Who made this approach? If it's the Greek Colour Method…'), which he would read as a guess he did not ask for. A question mark
 * inside a word or an address ('a?b=1') does not end it; an answer with no question is as it was. */
export function oneQuestion(answer: string): string {
  const end = answer.search(/\?(?=\s|$)/);
  return end < 0 ? answer : answer.slice(0, end + 1);
}
