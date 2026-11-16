/**
 * Acting on one AT-SPI node by its own interfaces, no pointer moved: an
 * Action by name, the keyboard's focus, scrolling it into view, its text
 * set, its value stepped, a child selected. Each says whether the toolkit
 * did it; the caller falls back to the agent's own pointer and keys (D110)
 * where it did not.
 */

import { variant } from "../../../shared/dbus/index.ts";
import type { A11yNode } from "../../atspi/index.ts";
import type { Element } from "../types.ts";

const ATSPI = "org.a11y.atspi.";
const PROPERTIES = "org.freedesktop.DBus.Properties";
/** ATSPI_SCROLL_ANYWHERE. */
const SCROLL_ANYWHERE = 6;
/** ATSPI_COORD_TYPE_WINDOW. */
const WINDOW_COORDS = 1;

/** Action names that mean "use it", most specific first. */
export const PRESS_ACTIONS = ["click", "press", "activate", "toggle", "jump", "open", "select", "default"] as const;
const EXPAND_ACTIONS = ["expand or contract", "expand", "collapse", "toggle", "activate"] as const;

const ok = (value: unknown): boolean => value !== false && value !== null;

async function ask(node: A11yNode, iface: string, member: string, signature?: string, body?: unknown[]): Promise<unknown> {
  if (!node.ask) throw new Error("this node can't be asked");
  return node.ask(iface, member, signature, body);
}

/** Do the first of `names` the element has; false when it has none of them or the toolkit refused. */
export async function doAction(node: A11yNode, element: Element, names: readonly string[]): Promise<string | null> {
  const lower = element.actions.map((name) => name.toLowerCase());
  for (const name of names) {
    const index = lower.indexOf(name);
    if (index < 0) continue;
    const done = await ask(node, `${ATSPI}Action`, "DoAction", "i", [index]).catch(() => false);
    if (ok(done)) return element.actions[index] ?? name;
  }
  return null;
}

export const press = (node: A11yNode, element: Element): Promise<string | null> => doAction(node, element, PRESS_ACTIONS);

export const expandAction = (node: A11yNode, element: Element): Promise<string | null> => doAction(node, element, EXPAND_ACTIONS);

/** Give it the keyboard: Component's GrabFocus, else its "focus" action. */
export async function focus(node: A11yNode, element: Element): Promise<boolean> {
  if (element.interfaces.includes("Component") && ok(await ask(node, `${ATSPI}Component`, "GrabFocus").catch(() => false))) return true;
  return (await doAction(node, element, ["focus", "grab focus"])) !== null;
}

export async function scrollIntoView(node: A11yNode, element: Element): Promise<boolean> {
  if (element.interfaces.includes("Component") && ok(await ask(node, `${ATSPI}Component`, "ScrollTo", "u", [SCROLL_ANYWHERE]).catch(() => false))) return true;
  return (await doAction(node, element, ["scroll into view", "scrollintoview", "show"])) !== null;
}

/** Replace a field's text through EditableText; false where it has none. */
export async function setText(node: A11yNode, element: Element, words: string): Promise<boolean> {
  if (!element.interfaces.includes("EditableText")) return false;
  return ok(await ask(node, `${ATSPI}EditableText`, "SetTextContents", "s", [words]).catch(() => false));
}

/** Move a value by `steps` of its step (a tenth of its range when it gives none); false without a Value. */
export async function stepValue(node: A11yNode, element: Element, steps: number): Promise<boolean> {
  const value = element.value;
  if (!value) return false;
  const step = value.step > 0 ? value.step : (value.max - value.min) / 10 || 1;
  const next = Math.min(value.max > value.min ? value.max : Number.POSITIVE_INFINITY, Math.max(value.min, value.now + steps * step));
  return ok(
    await ask(node, PROPERTIES, "Set", "ssv", [`${ATSPI}Value`, "CurrentValue", variant("d", next)])
      .then(() => true)
      .catch(() => false),
  );
}

/** Select the child at `index` of a list through its Selection interface. */
export async function selectChild(node: A11yNode, element: Element, index: number): Promise<boolean> {
  if (!element.interfaces.includes("Selection")) return false;
  return ok(await ask(node, `${ATSPI}Selection`, "SelectChild", "i", [index]).catch(() => false));
}

/** Where it is in its window's content, for a click by pointer at its centre. */
export async function centre(node: A11yNode): Promise<{ x: number; y: number } | null> {
  const rect = await ask(node, `${ATSPI}Component`, "GetExtents", "u", [WINDOW_COORDS]).catch(() => null);
  if (!Array.isArray(rect) || rect.length !== 4) return null;
  const [x, y, width, height] = rect.map(Number);
  if (![x, y, width, height].every(Number.isFinite) || !width || !height || (width ?? 0) <= 0 || (height ?? 0) <= 0) return null;
  return { x: (x ?? 0) + (width ?? 0) / 2, y: (y ?? 0) + (height ?? 0) / 2 };
}
