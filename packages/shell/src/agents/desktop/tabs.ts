/**
 * Carrying out the tab tools (tools/lib/tabs.ts) through Dashi's extension.
 * A tab's title and address are said when the agent may see windows (Helium's
 * window titles already name the tab in front) or was allowed its site; else
 * its site only. Closing a tab just closes it: nothing is lost for good (D204).
 */

import { isRecord } from "@dashi/shape";
import { parseTab, type TabInfo } from "../../browser/index.ts";
import { json, type RunContext, type ToolResult, text, toolError } from "../context.ts";
import type { Call } from "../tools/index.ts";
import { about, chooseTab, failed, isResult, linkFor, listTabs, tabId } from "./browser.ts";

/** A tab tool's call: the list, a switch, or one of four on a tab (the agent's last when null). */
type OnTab = { name: "close_tab" | "reload_tab" | "go_back" | "go_forward"; tab: number | null };
type TabsCall = Extract<Call, { name: "list_tabs" }> | Extract<Call, { name: "switch_tab" }> | OnTab;

/** A tab as list_tabs says it. */
function row(tab: TabInfo, ctx: RunContext, focusedWindow: number | null): Record<string, unknown> {
  const shown = ctx.mayName() ? { tab: tabId(tab), url: tab.url, title: tab.title } : about(tab, ctx);
  return {
    ...shown,
    front: tab.active,
    window: tab.windowId,
    ...(tab.windowId === focusedWindow && tab.active ? { inFrontWindow: true } : {}),
    ...(tab.loading ? { loading: true } : {}),
    ...(ctx.browser.opened?.has(tab.id) ? { yours: true } : {}),
    ...(tab.id === ctx.browser.tab ? { lastUsed: true } : {}),
  };
}

async function closeTab(call: OnTab, ctx: RunContext): Promise<ToolResult> {
  const link = await linkFor(ctx, false);
  if (isResult(link)) return link;
  const tab = await chooseTab(link, call.tab, ctx);
  if (isResult(tab)) return tab;
  ctx.status("Closing a tab");
  await link.ask("close", { tab: tab.id });
  ctx.browser.opened?.delete(tab.id);
  if (ctx.browser.tab === tab.id) ctx.browser.tab = null;
  return text(`Closed tab ${tabId(tab)}.`, { closed: tabId(tab) });
}

async function move(call: OnTab, ctx: RunContext): Promise<ToolResult> {
  const link = await linkFor(ctx, false);
  if (isResult(link)) return link;
  const tab = await chooseTab(link, call.tab, ctx);
  if (isResult(tab)) return tab;
  const method = call.name === "reload_tab" ? "reload" : call.name === "go_back" ? "back" : "forward";
  ctx.status(call.name === "reload_tab" ? "Reloading a page" : call.name === "go_back" ? "Going back" : "Going forward");
  ctx.browser.tab = tab.id;
  const result = await link.ask(method, { tab: tab.id });
  const now: TabInfo = {
    ...tab,
    url: typeof result.url === "string" ? result.url : tab.url,
    title: typeof result.title === "string" ? result.title : tab.title,
  };
  const loaded = isRecord(result.load) && result.load.loaded === true;
  const shown = about(now, ctx);
  const where = `${shown.url}${shown.title ? ` (“${shown.title}”)` : ""}`;
  if (call.name !== "reload_tab" && result.moved !== true)
    return text(`There was no page to go ${method} to: tab ${tabId(tab)} is still at ${where}.`, { ...shown, moved: false });
  return text(`Tab ${tabId(tab)} is at ${where}. ${loaded ? "It loaded." : 'It is still loading: wait_for {page: "loaded"}.'}`, { ...shown, loaded });
}

export async function tabsCall(call: TabsCall, ctx: RunContext): Promise<ToolResult> {
  try {
    switch (call.name) {
      case "list_tabs": {
        const link = await linkFor(ctx, false);
        if (isResult(link)) return link;
        ctx.status("Looking at your tabs");
        const { tabs, focusedWindow } = await listTabs(link);
        return json({ tabs: tabs.map((tab) => row(tab, ctx, focusedWindow)) });
      }
      case "switch_tab": {
        const link = await linkFor(ctx, false);
        if (isResult(link)) return link;
        ctx.status("Switching tabs");
        const result = await link.ask("activate", { tab: call.tab });
        const tab = parseTab(result.tab);
        if (!tab) return toolError(`There is no tab t${call.tab}; list_tabs shows them.`);
        ctx.browser.tab = tab.id;
        return text(`Tab ${tabId(tab)} is in front: ${String(about(tab, ctx).url)}.`, about(tab, ctx));
      }
      case "close_tab":
        return await closeTab(call, ctx);
      default:
        return await move(call, ctx);
    }
  } catch (error) {
    return failed(error);
  }
}
