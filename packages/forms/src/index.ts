// @voice-kit/forms: a form as the tutor sees it (mw-o7cts8.1). A FormSpec (text, link, choice and pictures fields), the fields of a
// request, the values an answer may fill, requiredFilled and oneQuestion; and formCommand(form), the Command that sends the form for
// @voice-kit/talks' registry, so the form's Send button and the tutor call one path. Imports only types from @voice-kit/talks.
export {
  applyValues,
  FORM_FIELD_MAX,
  FORM_NAME_MAX,
  FORM_START,
  FORM_VALUE_MAX,
  HINT_MAX,
  LABEL_MAX,
  MAX_FORM_FIELDS,
  oneQuestion,
  requestFields,
  requiredFilled,
  type FormField,
  type FormFieldKind,
  type FormFieldState,
  type FormRequest,
  type FormSpec,
  type FormValue,
} from './form.js';
export { argsOf, argsSchema, formCommand, type FormArgs, type FormCommandOptions } from './command.js';
