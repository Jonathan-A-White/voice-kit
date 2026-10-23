// command.ts (mw-o7cts8.1) — the Command a form adds to the app's registry. The Governor's word (mw-t3xu9a Q3): the buttons and the
// tutor call the same commands. The form's Send button passes `argsOf(form, values)`; the tutor's `do` passes the same names and values;
// the registry checks both against the schema built here, and `send` is the one path that sends.
import type { ArgsSchema, Command, CommandKind } from 'voice-kit/talks';
import { FORM_VALUE_MAX, type FormSpec } from './form.js';

/** The values of a form as its command takes them: the field names he types into, each with its text. */
export type FormArgs = Record<string, string>;

export interface FormCommandOptions {
  /** the command's name on the registry: the tutor calls it by this, and the request's `form.command` carries it */
  name: string;
  /** one line for the tutor: what the command does */
  tell: string;
  /** 'confirm' (default) waits for him to say yes to the offer; 'undoable' runs and gives the app its undo; 'free' runs at once */
  kind?: CommandKind;
  /** sends the form with these values; the line the app shows or says, and for an undoable form the way back */
  send(values: FormArgs): Promise<{ said: string; undo?: () => Promise<void> }>;
  /** the question put to him before it runs (for a confirm command); one line naming the form and the required values unless given */
  offer?(values: FormArgs): string;
}

/** The args the form's own Send button passes: the fields he types into that hold something, trimmed; an empty field is left out. A
 * pictures field is never an arg. */
export function argsOf(form: FormSpec, values: Readonly<Record<string, string>>): FormArgs {
  const args: FormArgs = {};
  for (const f of form.fields) {
    if (f.kind === 'pictures') continue;
    const text = (values[f.name] ?? '').trim();
    if (text) args[f.name] = text;
  }
  return args;
}

/** The args schema of the form's command: an object of its non-pictures fields, each a string (cut to its field's limit, or one of a
 * choice's options), the required fields required, and nothing else allowed. */
export function argsSchema(form: FormSpec): ArgsSchema {
  const typed = form.fields.filter((f) => f.kind !== 'pictures');
  return {
    type: 'object',
    properties: Object.fromEntries(
      typed.map((f): [string, ArgsSchema] => [
        f.name,
        { type: 'string', maxLength: f.maxLength ?? FORM_VALUE_MAX, ...(f.kind === 'choice' ? { enum: [...(f.options ?? [])] } : {}), description: f.label },
      ]),
    ),
    required: typed.filter((f) => f.required).map((f) => f.name),
    additionalProperties: false,
  };
}

/** 'Send Ask for a book: Wallace, Greek Grammar Beyond the Basics?': the form and what its required fields hold. */
function defaultOffer(form: FormSpec, values: FormArgs): string {
  const held = form.fields.filter((f) => f.required && values[f.name]).map((f) => values[f.name]);
  return `Send ${form.name}${held.length ? `: ${held.join(', ')}` : ''}?`;
}

/** The Command that sends `form` for the tutor's registry. Its args are checked by the registry before `send` runs. */
export function formCommand(form: FormSpec, options: FormCommandOptions): Command {
  const { name, tell, kind = 'confirm', send, offer } = options;
  return {
    name,
    tell,
    args: argsSchema(form),
    kind,
    offer: (args) => (offer ?? ((values: FormArgs) => defaultOffer(form, values)))(args as FormArgs),
    async run(args) {
      const sent = await send(args as FormArgs);
      return { said: sent.said, ...(sent.undo ? { undo: sent.undo } : {}) };
    },
  };
}
