/**
 * A form (store-v2 frame L8, docs/launcher-extensions.md "Forms"): fields the
 * launcher draws in a column, label at the left, and an `Action.SubmitForm`
 * that sends them. The launcher holds what is typed: `value` is where a field
 * starts, a draft kept wins over it, and `onChange` hears each change. Before
 * it sends, the launcher checks each field's `required` and `max` and shows
 * what is missing under it; an `error` the extension sets shows the same way,
 * until it takes it away.
 *
 *   <Form draft actions={<ActionPanel><Action.SubmitForm title="Create Issue" onSubmit={send} /></ActionPanel>}>
 *     <Form.Dropdown name="repo" title="Repository" value={last}>{repos.map((r) => <Form.Dropdown.Item key={r} title={r} value={r} />)}</Form.Dropdown>
 *     <Form.TextField name="title" title="Title" required max={256} />
 *     <Form.TextArea name="body" title="Description" />
 *     <Form.TagPicker name="labels" title="Labels">{labels.map((l) => <Form.TagPicker.Item key={l} title={l} value={l} />)}</Form.TagPicker>
 *   </Form>
 */

import { createElement, type ReactElement, type ReactNode } from "react";
import type { FieldValue } from "../view/wire.ts";

const h = (type: string, props: Record<string, unknown>, ...children: ReactNode[]): ReactElement => createElement(type, props, ...children);

interface FormProps {
  /** Keep what is typed when the launcher closes, until the form is sent. */
  draft?: boolean;
  loading?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}

interface FieldProps<T extends FieldValue> {
  /** The key of its value when the form is sent. */
  name: string;
  title: string;
  /** Where it starts; a draft kept wins. */
  value?: T;
  /** A line under it. */
  info?: string;
  /** Yours to set: shown under it, and the form isn't sent while one shows. */
  error?: string;
  required?: boolean;
  onChange?: (value: T) => void;
}

interface TextProps extends FieldProps<string> {
  placeholder?: string;
  /** At most this many characters. */
  max?: number;
}

function FormRoot({ draft, loading, actions, children }: FormProps) {
  return h("Form", { draft, loading }, children, actions);
}

/** The wire's name for `error` (elements.ts: a prop is never named `error`). */
const wire = <T extends { error?: string }>({ error, ...rest }: T): Record<string, unknown> => ({ ...rest, invalid: error });

function TextField(props: TextProps & { secure?: boolean }) {
  return h("TextField", wire(props));
}

function TextArea(props: TextProps) {
  return h("TextArea", wire(props));
}

function Option({ title, value }: { title: string; value: string }) {
  return h("Option", { title, value });
}

function DropdownRoot({ children, ...props }: FieldProps<string> & { children?: ReactNode }) {
  return h("Dropdown", wire(props), children);
}

function TagPickerRoot({ children, ...props }: FieldProps<readonly string[]> & { children?: ReactNode }) {
  return h("TagPicker", wire(props), children);
}

function Checkbox(props: FieldProps<boolean> & { label?: string }) {
  return h("Checkbox", wire(props));
}

function Description({ title, text }: { title?: string; text: string }) {
  return h("Description", { title, text });
}

export const Form = Object.assign(FormRoot, {
  TextField,
  TextArea,
  Dropdown: Object.assign(DropdownRoot, { Item: Option }),
  TagPicker: Object.assign(TagPickerRoot, { Item: Option }),
  Checkbox,
  Description,
});

/** What a form sends: each field's value by its `name`. */
export type FormValues = Record<string, FieldValue>;
