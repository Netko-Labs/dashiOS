/**
 * Carrying out the website tools (tools/browser.ts) through Dashi's browser
 * extension (browser/bridge.ts). Every tool names its site in the menu bar
 * ("Reading bodytech.com.co"), and acts on a site only once the person has
 * allowed it for this agent (sites.ts). Nothing here reads a field's secret:
 * the extension never sends one (browser-extension/src/page/).
 */

import type { BrowserLink } from "../../browser/bridge.ts";
import { parseTab, type TabInfo } from "../../browser/protocol.ts";
import { launchEntry, loadEntries } from "../../entries.ts";
import { json, type RunContext, type ToolResult, text, toolError } from "../context.ts";
import { siteOf } from "../sites.ts";
import type { Call } from "../tools/index.ts";

type BrowserCall = Extract<
  Call,
  { name: "open_url" | "read_page" | "click_element" | "fill_element" | "select_option" | "press" | "scroll_page" | "list_tabs" | "switch_tab" }
>;

export const NO_EXTENSION =
  "Dashi's browser extension isn't connected: it works in Helium, Dashi's browser. Open a page with open_url (it starts Helium), " +
  "or use the screenshot tools (screenshot, click, type_text) in another browser.";

/** How long open_url waits for a browser it started to connect. */
const START_MS = 20_000;

const tabId = (tab: TabInfo): string => `t${tab.id}`;

const failed = (error: unknown): ToolResult => toolError(error instanceof Error ? error.message : String(error));

/** Helium's entry, to start it when no browser is connected. */
function browserEntry() {
  return loadEntries().find((entry) => /^helium/i.test(entry.id) || entry.wmClass?.toLowerCase() === "helium") ?? null;
}

async function linkFor(ctx: RunContext, start: boolean): Promise<BrowserLink | ToolResult> {
  const link = ctx.browser.link();
  if (link) return link;
  const entry = start ? browserEntry() : null;
  if (!entry) return toolError(NO_EXTENSION);
  ctx.status(`Opening ${entry.name}`);
  if (launchEntry(entry) === null) return toolError(`${entry.name} could not start.`);
  return (await ctx.browser.whenConnected(START_MS)) ?? toolError(`${entry.name} started, but Dashi's extension didn't connect. ${NO_EXTENSION}`);
}

/** The page in front in the browser with Dashi's extension (the launcher's context chip); null without one. */
export async function frontPage(link: BrowserLink | null): Promise<{ url: string; title: string } | null> {
  if (!link) return null;
  try {
    const { tabs, focusedWindow } = await listTabs(link);
    const front = tabs.find((tab) => tab.active && tab.windowId === focusedWindow) ?? tabs.find((tab) => tab.active);
    return front?.url ? { url: front.url, title: front.title ?? "" } : null;
  } catch {
    return null;
  }
}

async function listTabs(link: BrowserLink): Promise<{ tabs: TabInfo[]; focusedWindow: number | null }> {
  const result = await link.ask("tabs", {});
  const tabs = (Array.isArray(result.tabs) ? result.tabs : []).map(parseTab).filter((tab): tab is TabInfo => tab !== null);
  return { tabs, focusedWindow: typeof result.focusedWindow === "number" ? result.focusedWindow : null };
}

/** The tab named, else the agent's last, else the one in front of the window used last. */
export async function chooseTab(link: BrowserLink, wanted: number | null, ctx: RunContext): Promise<TabInfo | ToolResult> {
  const { tabs, focusedWindow } = await listTabs(link);
  if (wanted !== null) return tabs.find((tab) => tab.id === wanted) ?? toolError(`There is no tab t${wanted}; list_tabs shows them.`);
  const last = tabs.find((tab) => tab.id === ctx.browser.tab);
  const front = tabs.find((tab) => tab.active && tab.windowId === focusedWindow) ?? tabs.find((tab) => tab.active);
  return last ?? front ?? toolError("The browser has no tab open; open_url opens one.");
}

const isResult = (value: object): value is ToolResult => "content" in value;

/** The tab's site, once the person allowed it for this agent; else why not. */
async function allowedSite(tab: TabInfo, ctx: RunContext): Promise<string | ToolResult> {
  const site = siteOf(tab.url);
  if (!site) return toolError(`Tab ${tabId(tab)} shows ${tab.url ? "a browser page" : "nothing yet"}, not a website: open_url a site first.`);
  return (await ctx.browser.allowSite(site)) ? site : refusedSite(site);
}

const refusedSite = (site: string): ToolResult => toolError(`The person did not allow you to use ${site}. Don't try again unless they ask you to.`);

/** What a page's result says of a tab: its id and address, and its title where the agent may use the site. */
function about(tab: TabInfo, ctx: RunContext): Record<string, unknown> {
  const site = siteOf(tab.url);
  const allowed = site !== null && ctx.browser.mayUse(site);
  return { tab: tabId(tab), url: allowed ? tab.url : site, ...(allowed ? { title: tab.title } : {}) };
}

/** The tool's work with the tab it is for, its site allowed; the tab becomes the agent's. */
async function onPage(
  ctx: RunContext,
  wanted: number | null,
  verb: string,
  work: (link: BrowserLink, tab: TabInfo, site: string) => Promise<ToolResult>,
): Promise<ToolResult> {
  const link = await linkFor(ctx, false);
  if (isResult(link)) return link;
  try {
    const tab = await chooseTab(link, wanted, ctx);
    if (isResult(tab)) return tab;
    const site = await allowedSite(tab, ctx);
    if (typeof site !== "string") return site;
    ctx.browser.tab = tab.id;
    ctx.status(`${verb} ${site}`);
    return await work(link, tab, site);
  } catch (error) {
    return failed(error);
  }
}

function loadWords(load: unknown): string {
  if (typeof load !== "object" || load === null) return "";
  const { loaded, error } = load as { loaded?: unknown; error?: unknown };
  if (loaded === true) return "It loaded.";
  return error === "still loading" ? "It is still loading after 30 seconds." : `It didn't load${typeof error === "string" ? ` (${error})` : ""}.`;
}

async function openUrl(call: Extract<Call, { name: "open_url" }>, ctx: RunContext): Promise<ToolResult> {
  const site = siteOf(call.url);
  if (!site) return toolError("`url` must be an http or https address.");
  if (!(await ctx.browser.allowSite(site))) return refusedSite(site);
  const link = await linkFor(ctx, true);
  if (isResult(link)) return link;
  ctx.status(`Opening ${site}`);
  try {
    if (call.tab !== null) {
      const tab = await chooseTab(link, call.tab, ctx);
      if (isResult(tab)) return tab;
    }
    const started = Date.now();
    const result = await link.ask("open", { url: call.url, tab: call.tab });
    const tab = parseTab(result.tab);
    if (!tab) return toolError("The browser didn't say which tab it opened.");
    ctx.browser.tab = tab.id;
    const shown = about(tab, ctx);
    return text(`Tab ${tabId(tab)}: ${shown.url}${shown.title ? ` (“${shown.title}”)` : ""}. ${loadWords(result.load)} read_page to see it.`, {
      ...shown,
      loaded: (result.load as { loaded?: unknown } | undefined)?.loaded === true,
      ms: Date.now() - started,
    });
  } catch (error) {
    return failed(error);
  }
}

async function readPage(call: Extract<Call, { name: "read_page" }>, ctx: RunContext): Promise<ToolResult> {
  return onPage(ctx, call.tab, "Reading", async (link, tab) => {
    const result = await link.ask("read", { tab: tab.id });
    const now = parseTab(result.tab) ?? tab;
    const head = `Tab ${tabId(now)} · ${now.url} · “${now.title}”`;
    const cut = result.truncated === true ? "\n(The page goes on: scroll_page, or read it again later, for the rest.)" : "";
    return text(`${head}\n\n${String(result.text ?? "")}${cut}`);
  });
}

async function clickElement(call: Extract<Call, { name: "click_element" }>, ctx: RunContext): Promise<ToolResult> {
  return onPage(ctx, call.tab, "Clicking on", async (link, tab) => {
    const result = await link.ask("click", { tab: tab.id, ref: call.ref });
    const opened = parseTab(result.opened);
    if (opened) ctx.browser.tab = opened.id;
    const now = opened ?? parseTab(result.tab) ?? tab;
    const moved = opened
      ? `It opened tab ${tabId(opened)}: ${about(opened, ctx).url}. ${loadWords(result.load)}`
      : result.load
        ? `A page loaded: ${about(now, ctx).url}. ${loadWords(result.load)}`
        : "";
    return text(`Clicked [${call.ref}] ${String(result.described ?? "")}.${moved ? ` ${moved}` : ""}`, {
      ...about(now, ctx),
      navigated: result.load !== undefined,
    });
  });
}

async function fillElement(call: Extract<Call, { name: "fill_element" }>, ctx: RunContext): Promise<ToolResult> {
  return onPage(ctx, call.tab, "Filling in a field on", async (link, tab) => {
    const result = await link.ask("fill", { tab: tab.id, ref: call.ref, text: call.text });
    return text(`Filled [${call.ref}]: ${String(result.described ?? "")}.`);
  });
}

async function selectOption(call: Extract<Call, { name: "select_option" }>, ctx: RunContext): Promise<ToolResult> {
  return onPage(ctx, call.tab, "Choosing an option on", async (link, tab) => {
    const result = await link.ask("select", { tab: tab.id, ref: call.ref, value: call.value });
    return text(`Chose in [${call.ref}]: ${String(result.described ?? "")}.`);
  });
}

async function press(call: Extract<Call, { name: "press" }>, ctx: RunContext): Promise<ToolResult> {
  return onPage(ctx, call.tab, "Pressing keys on", async (link, tab) => {
    const result = await link.ask("press", { tab: tab.id, chords: call.chords });
    const did = Array.isArray(result.did) ? result.did.map(String).join(", ") : call.keys;
    return text(`Pressed ${did}. read_page to see what the page did.`);
  });
}

async function scrollPage(call: Extract<Call, { name: "scroll_page" }>, ctx: RunContext): Promise<ToolResult> {
  return onPage(ctx, call.tab, "Scrolling", async (link, tab) => {
    const result = await link.ask("scroll", { tab: tab.id, how: call.direction, pages: call.pages, ...(call.ref !== null ? { ref: call.ref } : {}) });
    return json({ tab: tabId(tab), ...result });
  });
}

export async function browserCall(call: BrowserCall, ctx: RunContext): Promise<ToolResult> {
  switch (call.name) {
    case "open_url":
      return openUrl(call, ctx);
    case "read_page":
      return readPage(call, ctx);
    case "click_element":
      return clickElement(call, ctx);
    case "fill_element":
      return fillElement(call, ctx);
    case "select_option":
      return selectOption(call, ctx);
    case "press":
      return press(call, ctx);
    case "scroll_page":
      return scrollPage(call, ctx);
    case "list_tabs": {
      const link = await linkFor(ctx, false);
      if (isResult(link)) return link;
      ctx.status("Looking at your tabs");
      try {
        const { tabs } = await listTabs(link);
        return json({
          tabs: tabs.map((tab) => ({ ...about(tab, ctx), active: tab.active, window: tab.windowId, ...(tab.id === ctx.browser.tab ? { yours: true } : {}) })),
        });
      } catch (error) {
        return failed(error);
      }
    }
    case "switch_tab": {
      const link = await linkFor(ctx, false);
      if (isResult(link)) return link;
      ctx.status("Switching tabs");
      try {
        const result = await link.ask("activate", { tab: call.tab });
        const tab = parseTab(result.tab);
        if (!tab) return toolError(`There is no tab t${call.tab}; list_tabs shows them.`);
        ctx.browser.tab = tab.id;
        return text(`Tab ${tabId(tab)} is in front: ${String(about(tab, ctx).url)}.`, about(tab, ctx));
      } catch (error) {
        return failed(error);
      }
    }
  }
}
