/**
 * A form's fields as the launcher reads them (form-view.tsx): a field's
 * name, and the choices of a Dropdown or a TagPicker.
 */

import type { ViewNode } from "@dashi/applet";

/** The key a field's value goes by: its `name`. */
export const nameOf = (field: ViewNode): string => (typeof field.p.name === "string" ? field.p.name : field.i);

/** A Dropdown's or a TagPicker's options: what each shows, and its value. */
export function optionsOf(field: ViewNode): { title: string; value: string }[] {
  return field.c.flatMap((option) =>
    option.t === "Option" && typeof option.p.title === "string" && typeof option.p.value === "string" ? [{ title: option.p.title, value: option.p.value }] : [],
  );
}
