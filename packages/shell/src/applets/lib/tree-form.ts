/**
 * A form's fields as the shell holds them (docs/launcher-extensions.md
 * "Forms"; frame L8): what each holds now (what the person typed, else a
 * draft kept, else the extension's `value`), and what is wrong with them
 * before the form may be sent (`required` empty, more than `max`
 * characters, or the extension's own `invalid`). Pure, so the tests read it.
 */

import { FIELDS, type FieldType, type FieldValue, type ViewNode } from "@dashi/applet";

const isField = (node: ViewNode): node is ViewNode & { t: FieldType } => (FIELDS as readonly string[]).includes(node.t);

/** A form's fields, in order. */
export const fieldsOf = (root: ViewNode): ViewNode[] => (root.t === "Form" ? root.c.filter(isField) : []);

export const nameOf = (field: ViewNode): string => (typeof field.p.name === "string" ? field.p.name : field.i);

/** What a field holds when nothing was typed or kept: its `value`, else empty. */
export function startOf(field: ViewNode): FieldValue {
  const given = field.p.value;
  if (field.t === "Checkbox") return given === true;
  if (field.t === "TagPicker") return Array.isArray(given) ? given : [];
  if (field.t === "Dropdown") {
    const first = field.c.find((option) => typeof option.p.value === "string")?.p.value;
    return typeof given === "string" ? given : typeof first === "string" ? first : "";
  }
  return typeof given === "string" ? given : "";
}

/** Each field's value by name: typed (`held`), else kept (`draft`), else where it starts. A kept value of the wrong kind is dropped. */
export function valuesOf(
  root: ViewNode,
  held: Readonly<Record<string, FieldValue>>,
  draft: Readonly<Record<string, FieldValue>> = {},
): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  for (const field of fieldsOf(root)) {
    const name = nameOf(field);
    const start = startOf(field);
    const kept = held[name] ?? draft[name];
    out[name] = kept !== undefined && typeof kept === typeof start && Array.isArray(kept) === Array.isArray(start) ? kept : start;
  }
  return out;
}

const isEmpty = (value: FieldValue | undefined): boolean =>
  value === undefined || value === false || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);

/** What is wrong with each field, by name, in the person's words; empty when the form may be sent. */
export function problemsOf(root: ViewNode, values: Readonly<Record<string, FieldValue>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fieldsOf(root)) {
    const name = nameOf(field);
    const title = typeof field.p.title === "string" ? field.p.title : name;
    const value = values[name];
    const max = field.p.max;
    if (field.p.required === true && isEmpty(value)) out[name] = `${title} is needed`;
    else if (typeof max === "number" && typeof value === "string" && [...value].length > max) out[name] = `${title} is at most ${max} characters`;
    else if (typeof field.p.invalid === "string") out[name] = field.p.invalid;
  }
  return out;
}

/** The field named `name` on a form, or undefined. */
export const fieldNamed = (root: ViewNode, name: string): ViewNode | undefined => fieldsOf(root).find((field) => nameOf(field) === name);
