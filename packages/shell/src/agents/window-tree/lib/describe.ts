/**
 * One element's line after its number, in read_page's words:
 * `switch "Bluetooth" (on)`, `textbox "Name" value="Alex" (focused, caret 4)`,
 * `password field "Password" (filled: no)`, `button "Delete" (destructive)`.
 */

import type { Element } from "../types.ts";
import { CHECKABLE, FIELDS, has, R, roleWord, S } from "./roles.ts";
import { isDestructive, isPrimary, isSecret } from "./semantics.ts";

const MAX_VALUE = 200;
const MAX_NAME = 120;

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

const quote = (text: string): string => JSON.stringify(text);

/** A number as people write it: 0.5, not 0.5000001. */
const shown = (n: number): string => String(Math.round(n * 1000) / 1000);

/** What a field holds, a slider stands at, a combo box shows. */
function valueOf(element: Element): string | null {
  if (FIELDS.has(element.role)) {
    const multi = element.role === R.TERMINAL || has(element.states, S.MULTI_LINE);
    const text = element.text ?? "";
    if (!text) return null;
    return `value=${quote(multi ? clip(text.split("\n").slice(-20).join("\n"), MAX_VALUE * 4) : clip(text, MAX_VALUE))}`;
  }
  if (element.value) {
    const { now, min, max, text } = element.value;
    return `value=${text ? quote(clip(text, MAX_VALUE)) : shown(now)}${max > min ? ` (${shown(min)}–${shown(max)})` : ""}`;
  }
  if (element.role === R.COMBO_BOX) {
    const chosen = element.children.flatMap((menu) => [menu, ...menu.children]).find((option) => has(option.states, S.SELECTED));
    const name = chosen?.name || element.text || "";
    return name ? `value=${quote(clip(name, MAX_VALUE))}` : null;
  }
  return null;
}

function flags(element: Element, inSheet: boolean): string[] {
  const s = element.states;
  const out: string[] = [];
  if (isSecret(element)) out.push(`filled: ${(element.chars ?? 0) > 0 ? "yes" : "no"}`);
  if (CHECKABLE.has(element.role) || has(s, S.CHECKABLE)) {
    const on = has(s, S.CHECKED) || has(s, S.PRESSED);
    if (has(s, S.INDETERMINATE)) out.push("mixed");
    else if (element.role === R.SWITCH) out.push(on ? "on" : "off");
    else out.push(on ? "checked" : "not checked");
  }
  if (has(s, S.SELECTED)) out.push("selected");
  if (has(s, S.EXPANDABLE) || has(s, S.EXPANDED)) out.push(has(s, S.EXPANDED) ? "expanded" : "collapsed");
  if (has(s, S.FOCUSED)) out.push(element.caret !== undefined ? `focused, caret ${element.caret}` : "focused");
  if (FIELDS.has(element.role) && has(s, S.MULTI_LINE)) out.push("multiline");
  if (FIELDS.has(element.role) && (has(s, S.READ_ONLY) || (!has(s, S.EDITABLE) && element.role !== R.TERMINAL && element.role !== R.PASSWORD_TEXT)))
    out.push("read-only");
  if (has(s, S.REQUIRED)) out.push("required");
  if (!has(s, S.ENABLED) && !has(s, S.SENSITIVE)) out.push("disabled");
  if (isPrimary(element)) out.push("primary");
  if (isDestructive(element, inSheet)) out.push("destructive");
  if (has(s, S.BUSY)) out.push("busy");
  return out;
}

/** The line for `element` after its number; `inSheet` when it is inside a dialog or sheet. */
export function describe(element: Element, inSheet: boolean): string {
  const role = isSecret(element) && element.role !== R.PASSWORD_TEXT ? "password field" : roleWord(element.role);
  const name = clip(element.name || element.attributes["placeholder-text"] || "", MAX_NAME);
  const parts = [name ? `${role} ${quote(name)}` : role];
  const value = isSecret(element) ? null : valueOf(element);
  if (value) parts.push(value);
  const list = flags(element, inSheet);
  return `${parts.join(" ")}${list.length > 0 ? ` (${list.join(", ")})` : ""}`;
}
