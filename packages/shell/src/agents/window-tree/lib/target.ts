/**
 * An element's number back to its live node: the window it was read in,
 * still there and not the person's, and the node still alive. A number
 * whose element is gone says so, with the fresh tree around where it was,
 * so the next call needs no extra read.
 */

import type { CompositorWindow } from "../../../compositor/index.ts";
import { type RunContext, type ToolResult, toolError } from "../../context.ts";
import { named, noWindow } from "../../lib/subject.ts";
import type { A11yNode } from "../../atspi/index.ts";
import { findKey, numbering, personWords, readTree } from "../read.ts";
import type { Element, TreeBus, TreesRun } from "../types.ts";
import { readNode } from "./bus.ts";
import type { Numbered } from "./numbers.ts";
import { renderRows, renderTree } from "./render.ts";
import { has, S } from "./roles.ts";

export interface Target {
  number: number;
  entry: Numbered;
  window: CompositorWindow;
  bus: TreeBus;
  app: A11yNode;
  node: A11yNode;
  /** The element as it is now. */
  element: Element;
  trees: TreesRun;
}

/** Lines of the fresh tree given with a number that is gone, at most. */
const AROUND_LINES = 60;

export const isResult = (value: object): value is ToolResult => "content" in value;

const splitKey = (key: string): { name: string; path: string } => {
  const slash = key.indexOf("/");
  return slash < 0 ? { name: key, path: "" } : { name: key.slice(0, slash), path: key.slice(slash) };
};

const clipLines = (text: string, max: number): string => {
  const lines = text.split("\n");
  return lines.length > max ? `${lines.slice(0, max).join("\n")}\n… (read_window for the rest)` : text;
};

/** The words for a number that is gone, and the window's tree around where it was. */
async function gone(number: number, entry: Numbered, window: CompositorWindow, trees: TreesRun): Promise<ToolResult> {
  const fresh = await readTree(trees, window);
  const head = `[${number}] (${entry.said}) is no longer in w${window.id}: the view changed.`;
  if (typeof fresh === "string") return toolError(`${head} ${fresh}`);
  const ctx = { window: window.id, numberOf: numbering(trees, window.id) };
  const parent = entry.parent ? findKey(fresh.root, entry.parent) : null;
  const body = parent && parent !== fresh.root ? renderRows(parent, ctx) : renderTree(fresh.root, ctx);
  return toolError(`${head} ${parent ? "Where it was, now:" : "The window now:"}\n${clipLines(body.text, AROUND_LINES)}`);
}

export async function target(number: number, windowId: number | null, ctx: RunContext): Promise<Target | ToolResult> {
  const trees = ctx.trees;
  if (!trees) return toolError("Reading windows as elements isn't available here.");
  const entry = trees.numbers.get(number);
  if (!entry || (windowId !== null && entry.window !== windowId))
    return toolError(`There is no [${number}]${windowId !== null ? ` in w${windowId}` : ""}: read_window${windowId !== null ? ` w${windowId}` : ""} gives the numbers.`);
  const window = await named(ctx.compositor, entry.window);
  if (!window) {
    trees.numbers.forgetWindow(entry.window);
    return noWindow(entry.window);
  }
  const theirs = trees.personOnly(window);
  if (theirs) return toolError(personWords(theirs, window.id));
  const bus = await trees.bus();
  if (!bus || window.pid === null) return toolError(`w${window.id} can't be reached through accessibility now; take a screenshot.`);
  const app = await bus.appFor(window.pid);
  const { name, path } = splitKey(entry.key);
  if (!app?.at || !app.key?.startsWith(name)) return gone(number, entry, window, trees);
  const node = app.at(path);
  const element = await readNode(node);
  if (!element || has(element.states, S.DEFUNCT)) return gone(number, entry, window, trees);
  return { number, entry, window, bus, app, node, element, trees };
}
