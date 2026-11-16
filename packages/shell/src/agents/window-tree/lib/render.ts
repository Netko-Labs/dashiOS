/**
 * A window's tree as read_window's text: the lines read_page writes for a
 * web page (`[12] button "Sign in"`, `# Heading`, text in reading order),
 * with the hierarchy kept by indentation. Pure over `Element`s, so it is
 * tested on trees recorded in the VM.
 *
 * - Layout (panels, fillers, unnamed groups) says nothing: its children
 *   join the line above. Text is a line of its own; text that only repeats
 *   its parent's name is left out.
 * - What can be used gets a number (`numberOf`), its role, name, value and
 *   states. A secret field says whether it is filled, never what with.
 * - A list says how many rows it has and gives a page of them, with the call
 *   for the next; never 240 lines unasked.
 */

import type { Element } from "../types.ts";
import { describe } from "./describe.ts";
import { CHECKABLE, DIALOGS, FIELDS, has, LAYOUT, R, ROWS, roleWord, S, TEXTUAL } from "./roles.ts";
import { type Hints, holdsFilledSecret, isModal } from "./semantics.ts";

export interface RenderLimits {
  chars: number;
  elements: number;
}

export const RENDER_LIMITS: RenderLimits = { chars: 40_000, elements: 1500 };

/** Rows of a list given in one read. */
export const PAGE = 40;

export interface RenderContext {
  /** The window's id, for the next page's call. */
  window: number;
  /** An element's number (the same for the same node every read). */
  numberOf(element: Element, parent: Element | null, said: string): number;
  /** Whether this dialog is the person's alone: it is named, and its contents left out. */
  personOnly?(dialog: Element): string | null;
}

/** Whether an element is something to use (it gets a number). */
export function usable(element: Element): boolean {
  if (FIELDS.has(element.role) || CHECKABLE.has(element.role) || ROWS.has(element.role)) return true;
  if (TEXTUAL.has(element.role) || element.role === R.HEADING) return false;
  if (LAYOUT.has(element.role) && element.actions.length === 0) return false;
  if (element.actions.length > 0 || element.interfaces.includes("Value") || element.interfaces.includes("EditableText")) return true;
  return has(element.states, S.SELECTABLE) || has(element.states, S.FOCUSABLE) || element.role === R.LIST_ITEM || element.role === R.PAGE_TAB;
}

const clean = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The words a text element shows. */
const wordsOf = (element: Element): string => clean(element.text ?? "") || clean(element.name);

class Out {
  readonly lines: string[] = [];
  private chars = 0;
  private elements = 0;
  cut = false;
  constructor(private readonly limits: RenderLimits) {}

  line(indent: number, text: string, element = false): boolean {
    if (this.cut) return false;
    if (element && ++this.elements > this.limits.elements) this.cut = true;
    const line = `${"  ".repeat(indent)}${text}`;
    if (this.cut || this.chars + line.length > this.limits.chars) {
      this.cut = true;
      return false;
    }
    this.chars += line.length + 1;
    this.lines.push(line);
    return true;
  }
}

/** The words of an element made only of text (a row holding a label), else "". */
function wordsInside(element: Element): string {
  if (element.children.length === 0 || FIELDS.has(element.role)) return "";
  const parts: string[] = [];
  const only = (node: Element): boolean => {
    if (TEXTUAL.has(node.role) && node.children.length === 0) {
      parts.push(wordsOf(node));
      return true;
    }
    return (LAYOUT.has(node.role) || node.role === R.IMAGE || node.role === R.ICON) && !usable(node) && node.children.every(only);
  };
  return element.children.every(only) ? clean(parts.join(" ")).slice(0, 120) : "";
}

/** The line for a list's rows beyond the page given. */
function moreRows(list: Element, number: number, ctx: RenderContext): string {
  const rows = list.children.map((child) => child.row ?? 0);
  const first = rows.length > 0 ? Math.min(...rows) : 0;
  const last = rows.length > 0 ? Math.max(...rows) + 1 : 0;
  if (list.childCount <= list.children.length && first === 0) return "";
  const next = last < list.childCount ? `; next: read_window {"window":"w${ctx.window}","list":${number},"from":${last}}` : "";
  return ` (${list.childCount} rows; rows ${first + 1}–${last} here${next})`;
}

function walk(element: Element, parent: Element | null, indent: number, out: Out, ctx: RenderContext, hints: Hints): void {
  if (out.cut) return;
  if (element.role === R.HEADING) {
    const level = Math.min(6, Math.max(1, Number(element.attributes.level) || 2));
    const words = wordsOf(element);
    if (words) out.line(indent, `${"#".repeat(level)} ${words}`);
    return;
  }
  if (TEXTUAL.has(element.role) && element.children.length === 0) {
    const words = wordsOf(element);
    if (words && words !== clean(parent?.name ?? "")) out.line(indent, words);
    return;
  }
  const dialog = DIALOGS.has(element.role) || (isModal(element) && element.role !== R.FRAME);
  if (dialog) return sheet(element, indent, out, ctx, hints);
  if (usable(element)) {
    // A row or button with no name of its own is named by the words in it (GTK's list rows), which are not read again.
    const words = element.name ? "" : wordsInside(element);
    if (words) element = { ...element, name: words, children: [] };
    const said = describe(element, hints);
    const number = ctx.numberOf(element, parent, said);
    const more = ROWS.has(element.role) ? moreRows(element, number, ctx) : "";
    out.line(indent, `[${number}] ${said}${more}`, true);
    for (const child of element.children) walk(child, element, indent + 1, out, ctx, hints);
    return;
  }
  const named = clean(element.name);
  if (named && !LAYOUT.has(element.role)) {
    out.line(indent, describe(element, hints));
    for (const child of element.children) walk(child, element, indent + 1, out, ctx, hints);
    return;
  }
  for (const child of element.children) walk(child, parent, indent, out, ctx, hints);
}

/** A sheet or dialog: marked, and when it is the person's, named and left closed. */
function sheet(element: Element, indent: number, out: Out, ctx: RenderContext, hints: Hints): void {
  const theirs = ctx.personOnly?.(element) ?? null;
  const name = clean(element.name);
  const head = `${DIALOGS.has(element.role) ? roleWord(element.role) : "sheet"}${name ? ` ${JSON.stringify(name)}` : ""}${isModal(element) ? " (modal)" : ""}`;
  if (theirs) {
    out.line(indent, `${head}: ${theirs}`);
    return;
  }
  out.line(indent, head);
  for (const child of element.children) walk(child, element, indent + 1, out, ctx, { ...hints, inSheet: true });
}

/** The tree under a window's root as lines; `cut` when the limits stopped it. */
export function renderTree(root: Element, ctx: RenderContext, limits: RenderLimits = RENDER_LIMITS): { text: string; cut: boolean } {
  const out = new Out(limits);
  const hints = { inSheet: false, secretFilled: holdsFilledSecret(root) };
  for (const child of root.children) walk(child, root, 0, out, ctx, hints);
  return { text: out.lines.join("\n"), cut: out.cut };
}

/** Only a list's rows (read_window's `list` and `from`), as lines under it. */
export function renderRows(list: Element, ctx: RenderContext, limits: RenderLimits = RENDER_LIMITS): { text: string; cut: boolean } {
  const out = new Out(limits);
  const number = ctx.numberOf(list, null, describe(list));
  out.line(0, `[${number}] ${describe(list)}${moreRows(list, number, ctx)}`, true);
  const hints = { inSheet: false, secretFilled: holdsFilledSecret(list) };
  for (const child of list.children) walk(child, list, 1, out, ctx, hints);
  return { text: out.lines.join("\n"), cut: out.cut };
}
