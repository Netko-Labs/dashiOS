/**
 * Acting on a native window's numbers (click_element, fill_element,
 * select_option, scroll_page and act_on_element with `window`): through the
 * toolkit's own accessibility actions and editable text where the element
 * has them (no pointer moved, the person's seat untouched), else the agent's
 * own pointer and keys at the element (D110). Each result says what the
 * element is now, and gives the window's fresh tree when it changed.
 * Only a critical element (it pays, signs in with a secret, loses work for
 * good, changes the system, sends as the person) is put to the person first.
 */

import type { PageChanges } from "../../browser/index.ts";
import { CRITICAL_KINDS, type Critical } from "../consent.ts";
import type { RunContext, ToolResult } from "../context.ts";
import { text, toolError } from "../context.ts";
import { changeWords } from "../lib/change-words.ts";
import { readNode } from "./lib/bus.ts";
import { describe } from "./lib/describe.ts";
import { centre, expandAction, focus, press, scrollIntoView, selectChild, setText, stepValue } from "./lib/do.ts";
import { renderTree } from "./lib/render.ts";
import { FIELDS, has, R, S } from "./lib/roles.ts";
import { criticalOf, isSecret } from "./lib/semantics.ts";
import { mark, settle } from "./lib/settle.ts";
import { isResult, type Target, target } from "./lib/target.ts";
import { findKey, numbering, readTree } from "./read.ts";

export type ElementAction = "press" | "focus" | "toggle" | "expand" | "collapse" | "increment" | "decrement" | "scroll_into_view";

/** Lines of the fresh tree a result carries when the window changed. */
const CHANGED_LINES = 120;

/** The critical flag read_window gave it ("critical: pays"), which knew what was around it. */
const CRITICAL_SAID = new RegExp(`critical: (${CRITICAL_KINDS.join("|")})`);

/** Why the person is asked, by kind of the one critical list (consent.ts). */
const ASK_WORDS: Record<Critical, string> = {
  pays: "It may pay for something.",
  secret: "It signs in with a saved password.",
  "loses work": "It may lose work for good: it can't be undone.",
  system: "It changes the system: software or an administrator's setting.",
  sends: "It sends something to someone as the person.",
};

/**
 * Critical (consent.ts `CRITICAL`, D260): pays, signs in with a secret,
 * loses work for good, changes the system, or sends as the person. Only those
 * are put to the person (how is the consent rule's: `TreesRun.yes`); false
 * when they did not say yes. Everything else just runs.
 */
async function cleared(t: Target, verb: string): Promise<boolean> {
  const kind = CRITICAL_SAID.exec(t.entry.said)?.[1] ?? criticalOf(t.element, { inSheet: false, secretFilled: false });
  const detail = Object.entries(ASK_WORDS).find(([each]) => each === kind)?.[1];
  if (!detail) return true;
  const name = t.element.name || t.entry.said;
  return t.trees.yes({
    summary: `${verb} “${name}” in ${t.window.title ? `“${t.window.title}”` : `w${t.window.id}`}`,
    detail,
    action: name.slice(0, 24) || "Go Ahead",
    danger: kind === "loses work",
  });
}

/**
 * What the element is now and, when the window changed, what changed: the
 * lines that are new beside the last read (a state elsewhere, a row), or the
 * whole fresh tree (cut at CHANGED_LINES) when its shape changed (a sheet
 * opened, a view replaced). The element's own line is in "Now:".
 */
async function after(t: Target, did: string, from: number): Promise<ToolResult> {
  const changed = await settle(t.bus, t.app, from);
  const now = await readNode(t.node);
  const still = now !== null && !has(now.states, S.DEFUNCT);
  const nowSaid = still && now ? describe(now) : undefined;
  const reread = `read_window w${t.window.id}`;
  if (!changed) return text(`${did} ${changeWords({ changed: "none", still, ...(nowSaid ? { now: nowSaid } : {}) }, "window", reread)}`);
  const fresh = await readTree(t.trees, t.window);
  if (typeof fresh === "string") return text(`${did} ${changeWords(null, "window", reread)}`);
  const lines = renderTree(fresh.root, { window: t.window.id, numberOf: numbering(t.trees, t.window.id) }).text;
  const before = t.trees.numbers.swap(t.window.id, lines);
  const seen = windowChanges(before, lines, t.number);
  const words = changeWords({ ...seen.changes, still, ...(nowSaid ? { now: nowSaid } : {}) }, "window", reread);
  return text(`${did} ${words}${seen.lines}`, { changes: { ...seen.changes, still } });
}

/**
 * How the window's lines moved since the last read, as the page's changes
 * are told (lib/change-words.ts): around the element or elsewhere, a dialog
 * that opened, new text, where the keyboard went; and the lines themselves,
 * with their numbers: those that changed, or the whole window when its shape
 * did (a sheet opened, a view replaced).
 */
export function windowChanges(before: string | null, after: string, own: number): { changes: Omit<PageChanges, "still">; lines: string } {
  const next = after.split("\n");
  if (before === null) return { changes: { changed: "elsewhere" }, lines: `\n\nThe window now:\n${cut(next)}` };
  const old = before.split("\n");
  const kept = new Set(old.map((line) => line.trim()));
  const numbered = (lines: readonly string[]) => lines.map((line) => /^\s*\[(\d+)\]/.exec(line)?.[1]).filter(Boolean);
  const sameShape = numbered(old).join() === numbered(next).join() && old.length === next.length;
  const at = next.findIndex((line) => line.trim().startsWith(`[${own}] `));
  const freshAt = next.flatMap((line, index) => (!kept.has(line.trim()) && index !== at ? [index] : []));
  if (freshAt.length === 0) return { changes: { changed: "none" }, lines: "" };
  const fresh = freshAt.map((index) => (next[index] ?? "").trim());
  const near = at >= 0 && freshAt.every((index) => Math.abs(index - at) <= NEAR_LINES);
  const dialog = /^(?:dialog|alert|sheet) "(.+?)"/.exec(fresh.find((line) => /^(dialog|alert|sheet) /.test(line)) ?? "")?.[1];
  const words = fresh
    .filter((line) => !line.startsWith("[") && !/^(dialog|alert|sheet) /.test(line))
    .join(" ")
    .slice(0, 200);
  const focus = fresh.find((line) => /\((?:[^)]*, )?focused[,)]/.test(line));
  const changes: Omit<PageChanges, "still"> = {
    changed: near ? "near" : "elsewhere",
    ...(dialog ? { dialog } : {}),
    ...(words ? { appeared: words } : {}),
    ...(focus ? { focus } : {}),
  };
  return { changes, lines: sameShape ? `\n\nChanged lines:\n${fresh.join("\n")}` : `\n\nThe window now:\n${cut(next)}` };
}

/** Lines either side of the element that count as "around it". */
const NEAR_LINES = 6;

const cut = (lines: readonly string[]): string =>
  `${lines.slice(0, CHANGED_LINES).join("\n")}${lines.length > CHANGED_LINES ? "\n… (read_window for the rest)" : ""}`;

/** The agent's own pointer and keys (desktop/input.ts), loaded when a fallback first needs them: the window tree alone starts nothing (dashi-a11y-dump). */
const hands = async () => (await import("../desktop/index.ts")).handsCall;

/** A click at the element's centre with the agent's own pointer (D110): for what has no action of its own. */
async function pointerClick(t: Target, ctx: RunContext): Promise<string | ToolResult> {
  const point = await centre(t.node);
  if (!point) return toolError(`[${t.number}] has no action of its own and no place on screen; take a screenshot of w${t.window.id} and click by pixel.`);
  const result = await (await hands())({ name: "click", window: t.window.id, x: point.x, y: point.y, button: "left", count: 1 }, ctx);
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
  return after(t, `Clicked [${t.number}] ${t.entry.said} (${how}).`, from);
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
  const all = (await import("../tools/index.ts")).parseKeys("❖A");
  if (typeof all === "string") return toolError(all);
  const handsCall = await hands();
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
