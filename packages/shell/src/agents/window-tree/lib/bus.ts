/**
 * Reading a window's AT-SPI tree into `Element`s: per node its role, states,
 * name, description, id, attributes, interfaces, actions, value and text,
 * the calls of one node made together. Bounded in nodes and time; a list's
 * rows are read only in the page asked for (`rows`), the rest counted. A
 * secret field's text is never asked for: only how long it is.
 */

import type { A11yNode } from "../../atspi/index.ts";
import type { Element, ElementValue } from "../types.ts";
import { FIELDS, has, R, ROWS, S } from "./roles.ts";

const POPUPS = new Set<number>([R.DIALOG, R.ALERT, R.POPUP_MENU, R.TOOL_TIP, R.WINDOW]);

import { isSecret } from "./semantics.ts";

const ATSPI = "org.a11y.atspi.";
const PROPERTIES = "org.freedesktop.DBus.Properties";
/** Text read from one node, at most. */
export const MAX_TEXT = 2000;
/** Children of a container that is not a list, at most. */
const MAX_CHILDREN = 400;
const MAX_DEPTH = 60;

export interface ReadLimits {
  nodes: number;
  /** Date.now() past which the walk stops. */
  deadline: number;
  /** Which rows of a list to read: by default the first page. */
  rows(list: { key: string; childCount: number }): { from: number; to: number };
}

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const unwrapped = (value: unknown): unknown => (value && typeof value === "object" && "value" in value ? (value as { value: unknown }).value : value);

function mapOf(value: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (value instanceof Map) for (const [k, v] of value) if (typeof k === "string") out.set(k, unwrapped(v));
  return out;
}

/** One node's facts, its children still to read. */
async function facts(node: A11yNode): Promise<{ element: Element; kids: A11yNode[] } | null> {
  const ask = node.ask;
  if (!ask) return null;
  const call = (iface: string, member: string, signature?: string, body?: unknown[]) => ask.call(node, iface, member, signature, body).catch(() => null);
  const [role, states, props, interfaces, attributes, kids] = await Promise.all([
    node.role().catch(() => -1),
    node.states().catch(() => [] as readonly number[]),
    call(PROPERTIES, "GetAll", "s", [`${ATSPI}Accessible`]),
    call(`${ATSPI}Accessible`, "GetInterfaces"),
    call(`${ATSPI}Accessible`, "GetAttributes"),
    node.children().catch(() => [] as A11yNode[]),
  ]);
  if (role < 0) return null;
  const p = mapOf(props);
  // Qt's bridge answers Get but not GetAll (measured in the VM: every name came back empty).
  if (p.size === 0) {
    const one = async (name: string) => unwrapped(await call(PROPERTIES, "Get", "ss", [`${ATSPI}Accessible`, name]));
    const [name, description, count] = await Promise.all([one("Name"), one("Description"), one("ChildCount")]);
    p.set("Name", name);
    p.set("Description", description);
    p.set("ChildCount", count);
  }
  const ifaces = (Array.isArray(interfaces) ? interfaces : []).map(str).map((name) => name.replace(ATSPI, ""));
  const attrs: Record<string, string> = {};
  for (const [k, v] of mapOf(attributes)) if (typeof v === "string") attrs[k] = v;
  const element: Element = {
    key: node.key ?? "",
    role,
    name: str(p.get("Name")),
    description: str(p.get("Description")),
    states,
    attributes: attrs,
    interfaces: ifaces,
    actions: [],
    childCount: Math.max(num(p.get("ChildCount")), kids.length),
    children: [],
  };
  const id = str(p.get("AccessibleId")) || attrs.id || "";
  if (id) element.id = id;
  await Promise.all([
    ifaces.includes("Action") ? actionsOf(element, call) : null,
    ifaces.includes("Value") ? valueOf(element, call) : null,
    ifaces.includes("Text") ? textOf(element, call) : null,
  ]);
  return { element, kids };
}

type Call = (iface: string, member: string, signature?: string, body?: unknown[]) => Promise<unknown>;

async function actionsOf(element: Element, call: Call): Promise<void> {
  const list = await call(`${ATSPI}Action`, "GetActions");
  element.actions = (Array.isArray(list) ? list : []).map((entry) => (Array.isArray(entry) ? str(entry[0]) : "")).filter(Boolean);
}

async function valueOf(element: Element, call: Call): Promise<void> {
  const p = mapOf(await call(PROPERTIES, "GetAll", "s", [`${ATSPI}Value`]));
  if (!p.has("CurrentValue")) return;
  const value: ElementValue = {
    now: num(p.get("CurrentValue")),
    min: num(p.get("MinimumValue")),
    max: num(p.get("MaximumValue")),
    step: num(p.get("MinimumIncrement")),
  };
  const words = str(p.get("Text"));
  if (words) value.text = words;
  element.value = value;
}

async function textOf(element: Element, call: Call): Promise<void> {
  const p = mapOf(await call(PROPERTIES, "GetAll", "s", [`${ATSPI}Text`]));
  const chars = num(p.get("CharacterCount"));
  element.chars = chars;
  // A secret's length is all it says (filled or not), and a terminal's scrollback is not read whole.
  if (isSecret(element) || chars === 0) return;
  const words = await call(`${ATSPI}Text`, "GetText", "ii", [0, Math.min(chars, MAX_TEXT)]);
  if (typeof words === "string") element.text = words;
  if (FIELDS.has(element.role) && has(element.states, S.FOCUSED)) element.caret = num(p.get("CaretOffset"));
}

/** One node read alone, without its children (what an action changed). */
export async function readNode(node: A11yNode): Promise<Element | null> {
  return (await facts(node))?.element ?? null;
}

/** Whether a node's subtree is left out: hidden by its toolkit (not visible), or gone. */
const hidden = (element: Element): boolean =>
  has(element.states, S.DEFUNCT) ||
  !has(element.states, S.VISIBLE) ||
  // A popup that is not showing (GTK keeps a password field's "Caps Lock is on" popover in the tree, visible but unmapped).
  (POPUPS.has(element.role) && !has(element.states, S.SHOWING));

/**
 * The tree under `root`, breadth first so a cut leaves the top whole.
 * Returns the root (null if it could not be read) and whether nothing was cut.
 */
export async function readElements(root: A11yNode, limits: ReadLimits): Promise<{ root: Element | null; complete: boolean }> {
  const top = await facts(root);
  if (!top) return { root: null, complete: false };
  let complete = true;
  let seen = 1;
  let level: Array<{ element: Element; kids: A11yNode[] }> = [top];
  for (let depth = 0; level.length > 0 && depth < MAX_DEPTH; depth++) {
    const next: typeof level = [];
    for (const { element, kids } of level) {
      if (hidden(element) && element !== top.element) continue;
      const range = ROWS.has(element.role) ? limits.rows({ key: element.key, childCount: kids.length }) : { from: 0, to: MAX_CHILDREN };
      const chosen = kids.slice(range.from, range.to);
      if (Date.now() > limits.deadline || seen + chosen.length > limits.nodes) {
        complete = false;
        continue;
      }
      seen += chosen.length;
      const read = await Promise.all(chosen.map((kid) => facts(kid)));
      const offset = ROWS.has(element.role) ? range.from : 0;
      read.forEach((got, i) => {
        if (!got) return;
        if (ROWS.has(element.role)) got.element.row = offset + i;
        element.children.push(got.element);
        next.push(got);
      });
    }
    level = next;
  }
  if (level.length > 0) complete = false;
  return { root: top.element, complete };
}
