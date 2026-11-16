/**
 * Acting on a native window's numbers (click_element, fill_element,
 * select_option, scroll_page and act_on_element with `window`): through the
 * toolkit's own accessibility actions and editable text where the element
 * has them (no pointer moved, the person's seat untouched), else the agent's
 * own pointer and keys at the element (D110). Each result says what the
 * element is now, and gives the window's fresh tree when it changed.
 * Something that deletes, sends or pays is asked about first (D221).
 */

import type { RunContext, ToolResult } from "../context.ts";
import { text, toolError } from "../context.ts";
import { handsCall } from "../desktop/index.ts";
import { parseKeys } from "../tools/index.ts";
import { readNode } from "./lib/bus.ts";
import { describe } from "./lib/describe.ts";
import { centre, expandAction, focus, press, scrollIntoView, selectChild, setText, stepValue } from "./lib/do.ts";
import { renderTree } from "./lib/render.ts";
import { FIELDS, has, R, S } from "./lib/roles.ts";
import { isDestructive, isSecret } from "./lib/semantics.ts";
import { mark, settle } from "./lib/settle.ts";
import { isResult, type Target, target } from "./lib/target.ts";
import { findKey, numbering, readTree } from "./read.ts";

export type ElementAction = "press" | "focus" | "toggle" | "expand" | "collapse" | "increment" | "decrement" | "scroll_into_view";

/** Lines of the fresh tree a result carries when the window changed. */
const CHANGED_LINES = 120;

const DESTRUCTIVE_SAID = /\((?:[^)]*, )?destructive[,)]/;

/** Ask first when the element deletes, sends or pays; false when the person did not say yes. */
async function cleared(t: Target, verb: string): Promise<boolean> {
  if (!DESTRUCTIVE_SAID.test(t.entry.said) && !isDestructive(t.element, false)) return true;
  const name = t.element.name || t.entry.said;
  return t.trees.yes({
    summary: `${verb} “${name}” in ${t.window.title ? `“${t.window.title}”` : `w${t.window.id}`}`,
    detail: "It may delete, send or pay for something, and it may not be undone.",
    action: name.slice(0, 24) || "Go Ahead",
    danger: true,
  });
}

/** What the element is now and, when the window changed, its tree. */
async function after(t: Target, did: string, from: number): Promise<ToolResult> {
  const changed = await settle(t.bus, t.app, from);
  const now = await readNode(t.node);
  const state = now && !has(now.states, S.DEFUNCT) ? `Now: ${describe(now, false)}.` : "It is gone now: the view changed.";
  let tree = "";
  if (changed) {
    const fresh = await readTree(t.trees, t.window);
    if (typeof fresh !== "string") {
      const lines = renderTree(fresh.root, { window: t.window.id, numberOf: numbering(t.trees, t.window.id) }).text.split("\n");
      tree = `\n\nThe window changed. Now:\n${lines.slice(0, CHANGED_LINES).join("\n")}${lines.length > CHANGED_LINES ? "\n… (read_window for the rest)" : ""}`;
    }
  }
  return text(`${did} ${state}${tree}`);
}

/** A click at the element's centre with the agent's own pointer (D110): for what has no action of its own. */
async function pointerClick(t: Target, ctx: RunContext): Promise<string | ToolResult> {
  const point = await centre(t.node);
  if (!point) return toolError(`[${t.number}] has no action of its own and no place on screen; take a screenshot of w${t.window.id} and click by pixel.`);
  const result = await handsCall({ name: "click", window: t.window.id, x: point.x, y: point.y, button: "left", count: 1 }, ctx);
  return result.isError ? result : "by the agent's pointer at its centre";
}

export async function clickOn(call: { ref: number; window: number | null }, ctx: RunContext): Promise<ToolResult> {
  const t = await target(call.ref, call.window, ctx);
  if (isResult(t)) return t;
  if (!(await cleared(t, "press"))) return toolError("The person did not say yes, so nothing was pressed. Don't try it again unless they ask.");
  ctx.status(`Pressing in w${t.window.id}`);
  const from = mark(t.bus, t.app);
  const action = await press(t.node, t.element);
  const how = action ? `by its “${action}” action; nothing moved on screen` : await pointerClick(t, ctx);
  if (typeof how !== "string") return how;
  return after(t, `Pressed [${t.number}] ${t.entry.said} (${how}).`, from);
}

export async function fillIn(call: { ref: number; text: string; window: number | null }, ctx: RunContext): Promise<ToolResult> {
  const t = await target(call.ref, call.window, ctx);
  if (isResult(t)) return t;
  if (isSecret(t.element)) return toolError(`[${t.number}] is a password or code field: sign_in and fill_code fill those, and you never hold the secret.`);
  if (!FIELDS.has(t.element.role) || t.element.role === R.TERMINAL)
    return toolError(`[${t.number}] is not a text field; click_element or act_on_element it instead.`);
  if (has(t.element.states, S.READ_ONLY)) return toolError(`[${t.number}] is read-only.`);
  ctx.status(`Filling in a field in w${t.window.id}`);
  const from = mark(t.bus, t.app);
  if (await setText(t.node, t.element, call.text)) return after(t, `Filled [${t.number}] through its editable text (nothing typed, nothing moved).`, from);
  // No editable text (Metal's fields today: for-mirin.md): its focus, then the agent's own keys.
  if (!(await focus(t.node, t.element))) {
    const clicked = await pointerClick(t, ctx);
    if (typeof clicked !== "string") return clicked;
  }
  const all = parseKeys("❖A");
  if (typeof all === "string") return toolError(all);
  const selected = await handsCall({ name: "press_keys", window: t.window.id, keys: "❖A", chords: all }, ctx);
  if (selected.isError) return selected;
  const typed = await handsCall({ name: "type_text", window: t.window.id, text: call.text }, ctx);
  if (typed.isError) return typed;
  return after(t, `Filled [${t.number}]: focused it, selected what it held and typed ${[...call.text].length} characters with the agent's own keys.`, from);
}

const word = (text: string): string => text.trim().toLowerCase();

export async function selectIn(call: { ref: number; value: string; window: number | null }, ctx: RunContext): Promise<ToolResult> {
  const t = await target(call.ref, call.window, ctx);
  if (isResult(t)) return t;
  ctx.status(`Choosing an option in w${t.window.id}`);
  const from = mark(t.bus, t.app);
  let tree = await readTree(t.trees, t.window, { key: t.entry.key, from: 0 });
  const options = (root: typeof tree) => {
    if (typeof root === "string") return [];
    const list = findKey(root.root, t.entry.key);
    return list ? [...list.children, ...list.children.flatMap((menu) => (menu.role === R.MENU || menu.role === R.LIST_BOX ? menu.children : []))] : [];
  };
  let found =
    options(tree).find((option) => word(option.name) === word(call.value)) ?? options(tree).find((option) => word(option.name).startsWith(word(call.value)));
  if (!found && (await press(t.node, t.element))) {
    // A combo box shows its options once opened.
    await settle(t.bus, t.app, from);
    tree = await readTree(t.trees, t.window, { key: t.entry.key, from: 0 });
    found = options(tree).find((option) => word(option.name) === word(call.value));
  }
  if (!found) {
    const names = options(tree)
      .map((option) => JSON.stringify(option.name))
      .slice(0, 30);
    return toolError(`[${t.number}] has no option “${call.value}”${names.length > 0 ? `; its options: ${names.join(", ")}` : ""}.`);
  }
  const index = t.element.children.findIndex((child) => child.key === found.key);
  const node = t.app.at?.(found.key.slice(found.key.indexOf("/")));
  const done = (index >= 0 && (await selectChild(t.node, t.element, index))) || (node && (await press(node, found)));
  if (!done) return toolError(`The option “${found.name}” can't be chosen through accessibility; click it by pixel after a screenshot.`);
  return after(t, `Chose “${found.name}” in [${t.number}].`, from);
}

export async function actOn(call: { ref: number; window: number | null; action: ElementAction }, ctx: RunContext): Promise<ToolResult> {
  const t = await target(call.ref, call.window, ctx);
  if (isResult(t)) return t;
  if (call.action === "press" || call.action === "toggle") return clickOn(call, ctx);
  const from = mark(t.bus, t.app);
  const expanded = has(t.element.states, S.EXPANDED);
  let done = false;
  switch (call.action) {
    case "focus":
      done = await focus(t.node, t.element);
      break;
    case "scroll_into_view":
      done = await scrollIntoView(t.node, t.element);
      break;
    case "increment":
    case "decrement":
      done = await stepValue(t.node, t.element, call.action === "increment" ? 1 : -1);
      break;
    case "expand":
    case "collapse":
      if (expanded === (call.action === "expand")) return text(`[${t.number}] is ${expanded ? "expanded" : "collapsed"} already.`);
      done = (await expandAction(t.node, t.element)) !== null;
      break;
  }
  if (!done)
    return toolError(`[${t.number}] can't ${call.action.replace(/_/g, " ")} through accessibility (its actions: ${t.element.actions.join(", ") || "none"}).`);
  return after(t, `Did ${call.action.replace(/_/g, " ")} on [${t.number}] ${t.entry.said}.`, from);
}

export async function scrollTo(call: { ref: number; window: number | null }, ctx: RunContext): Promise<ToolResult> {
  return actOn({ ...call, action: "scroll_into_view" }, ctx);
}
