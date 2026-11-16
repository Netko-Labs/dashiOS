/**
 * read_window: a native window as text with numbered elements, as read_page
 * gives a web page (docs/actions.md, "Native windows"). Through AT-SPI, so
 * a window on a Space that does not show reads the same (D85), and nothing
 * moves on screen. The person's windows (the Setup Assistant, the vault, a
 * window handed to them, Dashi's own sheets) are named, never read.
 */

import type { CompositorWindow } from "../../compositor/index.ts";
import type { RunContext, ToolResult } from "../context.ts";
import { text, toolError } from "../context.ts";
import { named, noWindow, subject } from "../lib/subject.ts";
import { readElements } from "./lib/bus.ts";
import { locate, noTree } from "./lib/locate.ts";
import { PAGE, renderRows, renderTree, usable } from "./lib/render.ts";
import { isDestructive } from "./lib/semantics.ts";
import type { Element, PersonOnly, TreesRun, WindowTree } from "./types.ts";

/** A walk's budget: a window bigger than this says it was cut. */
const NODES = 3000;
const READ_MS = 2500;

export const NO_TREES = "Reading windows as elements isn't available here; take a screenshot instead.";

/** Why a window is the person's, in the words a model reads. */
export function personWords(why: PersonOnly, id: number): string {
  const what = {
    setup: "the Setup Assistant",
    vault: "System Settings showing the person's passwords",
    "handed-over": "handed to the person (hand_over) until they press Done",
    consent: "one of Dashi's own sheets, asking the person",
  }[why];
  return `w${id} is ${what}: it is the person's to use, and its contents are not read to agents. Wait, or ask them.`;
}

/** The window's tree, read now; `list` and `from` read that list's rows from `from` instead of its first page. */
export async function readTree(trees: TreesRun, window: CompositorWindow, rows?: { key: string; from: number }): Promise<WindowTree | string> {
  const bus = await trees.bus();
  const where = await locate(bus, window);
  if ("none" in where) return noTree(where.none, window.id);
  void bus?.watchChanges?.();
  const started = Date.now();
  const { root, complete } = await readElements(where.root, {
    nodes: NODES,
    deadline: started + READ_MS,
    rows: (list) => (rows && list.key === rows.key ? { from: rows.from, to: rows.from + PAGE } : { from: 0, to: PAGE }),
  });
  if (!root) return noTree("no-frame", window.id);
  return { root, complete, ms: Date.now() - started };
}

/** The numbering a read gives: each usable element's number, remembered with what it was. */
export function numbering(trees: TreesRun, window: number): (element: Element, parent: Element | null, said: string) => number {
  return (element: Element, parent: Element | null, said: string): number => trees.numbers.number(window, element.key, parent?.key ?? null, said);
}

/** How many of a tree's elements a model can use, and how much text it holds: a thin tree means a screenshot. */
export function thin(root: Element): boolean {
  let usableCount = 0;
  let words = 0;
  const visit = (element: Element): void => {
    if (usable(element)) usableCount++;
    words += (element.text ?? element.name).length;
    for (const child of element.children) visit(child);
  };
  visit(root);
  return usableCount < 2 && words < 40;
}

/** Whether anything in the tree is marked destructive (for the header's line on consent). */
export const anyDestructive = (root: Element): boolean => isDestructive(root, false) || root.children.some((child) => anyDestructive(child));

async function header(window: CompositorWindow, tree: WindowTree, ctx: RunContext): Promise<string> {
  const sheets = (await ctx.compositor.windows()).filter((each) => each.sheetOf === window.id);
  const lines = [`Window w${window.id} · ${subject(window, ctx)} · ${window.appId} · read in ${tree.ms} ms`];
  for (const sheet of sheets) lines.push(`A sheet is open on it: w${sheet.id}. read_window w${sheet.id} to see it.`);
  return lines.join("\n");
}

export async function readWindow(call: { window: number; list: number | null; from: number }, ctx: RunContext): Promise<ToolResult> {
  const trees = ctx.trees;
  if (!trees) return toolError(NO_TREES);
  const window = await named(ctx.compositor, call.window);
  if (!window) return noWindow(call.window);
  const theirs = trees.personOnly(window);
  if (theirs) return text(personWords(theirs, window.id));
  ctx.status(`Reading ${subject(window, ctx)}`);
  const list = call.list === null ? null : trees.numbers.get(call.list);
  if (call.list !== null && (!list || list.window !== window.id))
    return toolError(`[${call.list}] is not a list of w${window.id}; read_window w${window.id} first.`);
  const tree = await readTree(trees, window, list ? { key: list.key, from: call.from } : undefined);
  if (typeof tree === "string") return toolError(tree);
  const ctxRender = { window: window.id, numberOf: numbering(trees, window.id) };
  const found = list ? findKey(tree.root, list.key) : null;
  if (list && !found) return toolError(`[${call.list}] is no longer in w${window.id}; read_window w${window.id} again.`);
  const body = found ? renderRows(found, ctxRender) : renderTree(tree.root, ctxRender);
  const notes: string[] = [];
  if (!tree.complete || body.cut) notes.push("(The window goes on past what was read: read a list's rows with `list` and `from`, or take a screenshot.)");
  if (thin(tree.root)) notes.push("(Its tree says little: the content is drawn, not described. Take a screenshot of it and click by pixel.)");
  return text([await header(window, tree, ctx), "", body.text, ...notes].join("\n"));
}

/** The element with `key` in a tree. */
export function findKey(root: Element, key: string): Element | null {
  if (root.key === key) return root;
  for (const child of root.children) {
    const found = findKey(child, key);
    if (found) return found;
  }
  return null;
}
