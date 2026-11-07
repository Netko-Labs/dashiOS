/**
 * Where the window is, and how it got there. A page is one of Discover, a
 * category, one of Flathub's collections in full ("See all"), search results
 * (apps and applets), an app's page, Installed, Updates, the menu bar
 * applets, or an applet's page; going into a page (or a search) pushes onto
 * a history that Back pops.
 */

import type { CategoryId, Collection } from "../../src/software/flathub.ts";

export type Page =
  | { kind: "discover" }
  | { kind: "category"; id: CategoryId }
  | { kind: "collection"; id: Collection }
  | { kind: "search"; query: string }
  | { kind: "app"; id: string }
  | { kind: "installed" }
  | { kind: "updates" }
  | { kind: "applets" }
  | { kind: "applet"; id: string };

export interface Nav {
  page: Page;
  /** Earlier pages, the latest last. */
  back: readonly Page[];
}

export const START: Nav = { page: { kind: "discover" }, back: [] };

const MAX_HISTORY = 30;

export function samePage(a: Page, b: Page): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Go to a top-level place from the sidebar: history starts over. */
export function goTo(page: Page): Nav {
  return { page, back: [] };
}

/** Open a page from inside another (an app from a list, a search): Back returns here. */
export function push(nav: Nav, page: Page): Nav {
  if (samePage(nav.page, page)) return nav;
  return { page, back: [...nav.back, nav.page].slice(-MAX_HISTORY) };
}

/** Typing in the search field: the results page follows the text instead of piling up. */
export function search(nav: Nav, query: string): Nav {
  const text = query.trim();
  if (text === "") return nav.page.kind === "search" ? { page: nav.back[nav.back.length - 1] ?? START.page, back: nav.back.slice(0, -1) } : nav;
  if (nav.page.kind === "search") return { page: { kind: "search", query: text }, back: nav.back };
  return push(nav, { kind: "search", query: text });
}

export function back(nav: Nav): Nav {
  const page = nav.back[nav.back.length - 1];
  return page ? { page, back: nav.back.slice(0, -1) } : nav;
}

export const canGoBack = (nav: Nav): boolean => nav.back.length > 0;

/** The sidebar places a deep link (`DASHI_SOFTWARE_PAGE`) may open on. */
export function startPage(name: string | undefined): Nav {
  if (name === "updates" || name === "installed" || name === "applets") return goTo({ kind: name });
  return START;
}

/** Whether an applet matches what was typed: its name, summary, author, or id. */
export function matches(query: string, fields: { name: string; summary: string; author: string; id: string }): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${fields.name} ${fields.summary} ${fields.author} ${fields.id}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}
