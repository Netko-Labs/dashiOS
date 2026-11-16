/**
 * The person's quicklinks and fallbacks as settings.json keeps them
 * (`launcher.quicklinks`, `launcher.fallbacks`): their shapes, the made ones,
 * and filling in the words. Light on purpose: Settings reads it
 * (settings-app/sections.ts); quicklinks.ts makes them actions.
 */

import { isRecord } from "@dashi/shape";

export interface Quicklink {
  id: string;
  name: string;
  /** https:// (or a dashi:// address), with `{Query}` where the words go. */
  url: string;
}

/** Made ones the person can add (From the Library…). */
export const QUICKLINK_LIBRARY: readonly Quicklink[] = [
  { id: "web", name: "Search the Web", url: "https://duckduckgo.com/?q={Query}" },
  { id: "github", name: "Search GitHub", url: "https://github.com/search?q={Query}" },
  { id: "flathub", name: "Search Flathub", url: "https://flathub.org/apps/search?q={Query}" },
  { id: "fedora", name: "Fedora Package", url: "https://packages.fedoraproject.org/search?query={Query}" },
  { id: "wikipedia", name: "Search Wikipedia", url: "https://en.wikipedia.org/w/index.php?search={Query}" },
  { id: "youtube", name: "Search YouTube", url: "https://www.youtube.com/results?search_query={Query}" },
  { id: "maps", name: "Search OpenStreetMap", url: "https://www.openstreetmap.org/search?query={Query}" },
];

/** What the launcher has before the person changes anything: Search the Web, which is also the first fallback. */
export const DEFAULT_QUICKLINKS: readonly Quicklink[] = [QUICKLINK_LIBRARY[0] as Quicklink];
export const DEFAULT_FALLBACKS: readonly string[] = ["dashi://quicklink/web"];

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const isUrl = (url: string): boolean => /^(https:\/\/|dashi:\/\/)[^\s"<>]+$/.test(url) && url.length <= 2048;

export const isQuicklink = (value: unknown): value is Quicklink =>
  isRecord(value) &&
  typeof value.id === "string" &&
  ID.test(value.id) &&
  typeof value.name === "string" &&
  value.name.trim().length > 0 &&
  value.name.length <= 60 &&
  typeof value.url === "string" &&
  isUrl(value.url);

export const isQuicklinkList = (value: unknown): value is Quicklink[] => Array.isArray(value) && value.length <= 64 && value.every(isQuicklink);

export const isFallbackList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 12 && value.every((each) => typeof each === "string" && each.startsWith("dashi://") && each.length <= 300);

/** The address with the words in it (encoded); without a `{Query}`, the address as it is. */
export function fillQuery(url: string, words: string): string {
  return url.replaceAll("{Query}", encodeURIComponent(words.trim()));
}

/** An id for a new quicklink's name: its words, lowercase, joined by dashes, made unique among `taken`. */
export function quicklinkId(name: string, taken: readonly string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32) || "link";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/** Where the quicklinks are kept (prefs.ts: settings.json `launcher.quicklinks`). */
export interface QuicklinkStore {
  list(): readonly Quicklink[];
  set(list: readonly Quicklink[]): void;
  subscribe(listener: () => void): () => void;
}
