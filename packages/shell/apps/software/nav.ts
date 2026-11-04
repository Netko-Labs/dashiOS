/**
 * Where the window is, and how it got there. A page is one of Discover,
 * a category, search results, an app's page, Installed, or Updates; going
 * into an app (or a search) pushes onto a history that Back pops.
 */

import type { CategoryId } from "../../src/software/flathub.ts";

export type Page =
  | { kind: "discover" }
  | { kind: "category"; id: CategoryId }
  | { kind: "search"; query: string }
  | { kind: "app"; id: string }
  | { kind: "installed" }
  | { kind: "updates" };

export interface Nav {
  page: Page;
  /** Earlier pages, the latest last. */
  back: readonly Page[];
}

export const START: Nav = { page: { kind: "discover" }, back: [] };

const MAX_HISTORY = 30;

export function samePage(a: Page, b: Page): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "category":
      return a.id === (b as typeof a).id;
    case "search":
      return a.query === (b as typeof a).query;
    case "app":
      return a.id === (b as typeof a).id;
    default:
      return true;
  }
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
