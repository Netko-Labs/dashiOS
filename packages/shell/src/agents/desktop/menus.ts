/**
 * The menu bar's menus for agents: what the bar shows for a window's app
 * (menus/start.tsx `menusOf`, apps' own menus included), and choosing a row
 * the way a click does. The Dashi menu stays the person's (power, lock, log
 * out), and Edit's keystroke rows are left to press_keys, which goes through
 * the agent's own keyboard rather than the person's.
 *
 * Rows are named by label, and the Window menu's are window titles, so
 * choosing needs "see" as well as "act": with "act" alone an agent could
 * learn titles by guessing.
 */

import type { CompositorWindow } from "../../compositor.ts";
import type { MenuAction, MenuEntry } from "../../menus/index.ts";
import { json, type RunContext, type ToolResult, text, toolError } from "../context.ts";
import { named, noWindow, subject } from "../lib/subject.ts";

type Item = Extract<MenuEntry, { kind: "item" }>;

/** Rows an agent can't choose here, and what to use instead. */
export function refusal(action: MenuAction | null): string | null {
  if (action?.kind === "edit") return "That item stands for a keystroke in the app; use press_keys (❖Z, ❖C, ❖V, …) in the window instead.";
  if (action?.kind === "app-item" && action.personOnly)
    return "The app keeps that item for the person; use its own tool, which asks them first (Software: request_software_install, request_software_update).";
  return null;
}

const listed = (entry: Item) => ({
  label: entry.label,
  ...(entry.keys ? { shortcut: entry.keys } : {}),
  enabled: entry.action !== null && refusal(entry.action) === null,
  ...(entry.checked === undefined ? {} : { checked: entry.checked }),
});

async function target(id: number | null, ctx: RunContext): Promise<CompositorWindow | ToolResult> {
  if (id !== null) return (await named(ctx.compositor, id)) ?? noWindow(id);
  const focused = (await ctx.compositor.windows()).find((window) => window.focused);
  return focused ?? toolError("No window is focused; name one with `window` (an id from list_windows).");
}

const isWindow = (value: CompositorWindow | ToolResult): value is CompositorWindow => "appId" in value;

export async function listMenus(id: number | null, ctx: RunContext): Promise<ToolResult> {
  const menus = ctx.desktop.menus;
  if (!menus) return toolError("There is no menu bar in this session.");
  const window = await target(id, ctx);
  if (!isWindow(window)) return window;
  ctx.status(`Looking at the menus of ${subject(window, ctx)}`);
  const built = await menus.of(window);
  return json({
    window: `w${window.id}`,
    menus: built.map((menu) => ({
      title: menu.title,
      items: menu.entries.flatMap((entry) => (entry.kind === "item" ? [listed(entry)] : [])),
    })),
  });
}

export async function chooseMenuItem(id: number, menuTitle: string, label: string, ctx: RunContext): Promise<ToolResult> {
  const menus = ctx.desktop.menus;
  if (!menus) return toolError("There is no menu bar in this session.");
  if (!ctx.mayName())
    return toolError("Menu items are named by what list_menus shows, which needs the “See windows and apps” permission; call list_menus first.");
  const window = await named(ctx.compositor, id);
  if (!window) return noWindow(id);
  const built = await menus.of(window);
  const menu = built.find((each) => each.title.toLowerCase() === menuTitle.toLowerCase());
  if (!menu) return toolError(`w${id} has no menu “${menuTitle}”; its menus are ${built.map((each) => `“${each.title}”`).join(", ")}.`);
  const items = menu.entries.filter((entry): entry is Item => entry.kind === "item" && entry.label === label);
  if (items.length === 0) return toolError(`The ${menu.title} menu has no item “${label}”; list_menus shows its items.`);
  if (items.length > 1) return toolError(`The ${menu.title} menu has more than one “${label}”.`);
  const item = items[0] as Item;
  const refused = refusal(item.action);
  if (refused) return toolError(refused);
  if (!item.action) return toolError(`“${label}” can't be chosen now (it is greyed out).`);
  ctx.status(`Choosing ${menu.title} › ${item.label} in ${subject(window, ctx)}`);
  await menus.run(item.action, built[0]?.title ?? menu.title);
  return text(`Chose ${menu.title} › ${item.label} for w${id}.`);
}
