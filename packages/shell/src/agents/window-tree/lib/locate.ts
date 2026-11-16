/**
 * A window's place on the accessibility bus: the app that runs as its
 * process, and the frame in it that is this window (one host can hold many:
 * the shell's Settings beside its other surfaces). Matched by title, then by
 * which is active, then the only one.
 */

import type { CompositorWindow } from "../../../compositor/index.ts";
import type { A11yNode } from "../../atspi/index.ts";
import type { TreeBus } from "../types.ts";
import { has, R, S } from "./roles.ts";

const PROPERTIES = "org.freedesktop.DBus.Properties";

async function nameOf(node: A11yNode): Promise<string> {
  const value = await node.ask?.(PROPERTIES, "Get", "ss", ["org.a11y.atspi.Accessible", "Name"]).catch(() => null);
  const raw = value && typeof value === "object" && "value" in value ? (value as { value: unknown }).value : value;
  return typeof raw === "string" ? raw : "";
}

export type Located = { app: A11yNode; root: A11yNode } | { none: "no-bus" | "no-pid" | "no-tree" | "no-frame" };

/** Where `window` is on the bus; a Chromium app is woken once (its tree is built only when asked). */
export async function locate(bus: TreeBus | null, window: CompositorWindow): Promise<Located> {
  if (!bus) return { none: "no-bus" };
  if (window.pid === null) return { none: "no-pid" };
  let app = await bus.appFor(window.pid);
  if (app && bus.wake && (await bus.wake(window.pid))) app = await bus.appFor(window.pid);
  if (!app) return { none: "no-tree" };
  const frames = await app.children().catch(() => [] as A11yNode[]);
  const facts = await Promise.all(
    frames.map(async (frame) => ({ frame, name: await nameOf(frame), role: await frame.role().catch(() => -1), states: await frame.states().catch(() => []) })),
  );
  const windows = facts.filter(({ role }) => role === R.FRAME || role === R.WINDOW || role === R.DIALOG || role === R.ALERT || role === R.FILE_CHOOSER);
  const pick =
    windows.find(({ name }) => name === window.title && name !== "") ??
    windows.find(({ name }) => window.title !== "" && name !== "" && window.title.includes(name)) ??
    (window.focused ? windows.find(({ states }) => has(states, S.ACTIVE)) : undefined) ??
    (windows.length === 1 ? windows[0] : undefined);
  return pick ? { app, root: pick.frame } : { none: "no-frame" };
}

/** What a model is told when a window has no tree, by why. */
export function noTree(none: Exclude<Located, { app: A11yNode }>["none"], id: number): string {
  const shot = `take a screenshot of w${id} instead, and click by pixel.`;
  switch (none) {
    case "no-bus":
      return `There is no accessibility bus in this session, so no window can be read as elements: ${shot}`;
    case "no-pid":
      return `w${id} doesn't say which process draws it (an X11 window without one), so its tree can't be found: ${shot}`;
    case "no-tree":
      return `w${id}'s app publishes no accessibility tree (a game, a canvas, or a toolkit without one): ${shot}`;
    case "no-frame":
      return `w${id}'s app publishes a tree, but none of its windows matches this one: ${shot}`;
  }
}
