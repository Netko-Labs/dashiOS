/**
 * Where the Applet Store's window is: a place in the sidebar (all applets, a
 * category, Installed, Updates), search results, or an applet's page; going
 * into a page pushes onto a history Back pops, as in Software.
 */

import type { Category } from "@dashi/applet";

export type Page =
  | { kind: "all" }
  | { kind: "category"; id: Category }
  | { kind: "search"; query: string }
  | { kind: "applet"; id: string }
  | { kind: "installed" }
  | { kind: "updates" };

export interface Nav {
  page: Page;
  back: readonly Page[];
}

export const START: Nav = { page: { kind: "all" }, back: [] };

export const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  hardware: "Hardware",
  productivity: "Productivity",
  network: "Network",
  status: "Status",
  media: "Media",
  developer: "Developer",
  utilities: "Utilities",
};

const same = (a: Page, b: Page): boolean => JSON.stringify(a) === JSON.stringify(b);

export const goTo = (page: Page): Nav => ({ page, back: [] });

export function push(nav: Nav, page: Page): Nav {
  return same(nav.page, page) ? nav : { page, back: [...nav.back, nav.page].slice(-30) };
}

/** Typing in the search field: the results follow the text; empty goes back. */
export function search(nav: Nav, query: string): Nav {
  const text = query.trim();
  if (text === "") return nav.page.kind === "search" ? { page: nav.back.at(-1) ?? START.page, back: nav.back.slice(0, -1) } : nav;
  if (nav.page.kind === "search") return { page: { kind: "search", query: text }, back: nav.back };
  return push(nav, { kind: "search", query: text });
}

export function back(nav: Nav): Nav {
  const page = nav.back.at(-1);
  return page ? { page, back: nav.back.slice(0, -1) } : nav;
}

export function pageTitle(page: Page): string {
  switch (page.kind) {
    case "all":
      return "Discover";
    case "category":
      return CATEGORY_LABELS[page.id];
    case "search":
      return `Results for “${page.query}”`;
    case "installed":
      return "Installed";
    case "updates":
      return "Updates";
    case "applet":
      return "";
  }
}

/** Whether an applet matches what was typed: its name, summary, author, or id. */
export function matches(query: string, fields: { name: string; summary: string; author: string; id: string }): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${fields.name} ${fields.summary} ${fields.author} ${fields.id}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export const canGoBack = (nav: Nav): boolean => nav.back.length > 0;
