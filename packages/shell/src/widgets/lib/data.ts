/** The widgets' data as React reads it: each source of the hub, repainting when it changes. */

import { useSyncExternalStore } from "react";
import type { Note } from "../../shared/notes/index.ts";
import type { Source } from "./sources/source.ts";

const NEVER = () => () => {};

export function useSource<T>(source: Pick<Source<T>, "subscribe" | "getSnapshot"> | null | undefined, fallback: T): T {
  return useSyncExternalStore(source?.subscribe ?? NEVER, source ? source.getSnapshot : () => fallback);
}

/** The note the Notes widget shows: the newest pinned one, else the newest. */
export function shownNote(notes: readonly Note[]): Note | null {
  const newest = (list: readonly Note[]) => [...list].sort((a, b) => b.modified - a.modified)[0] ?? null;
  return newest(notes.filter((note) => note.pinned)) ?? newest(notes);
}

/** "2 h ago", "5 min ago", "just now". */
export function ago(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

/** Two digits and two digits: "14:02" (24 h) or "2:02" (12 h without its mark: the widget is a number). */
export function clockText(at: number, hour24: boolean): string {
  const date = new Date(at);
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const hours = hour24 ? String(date.getHours()).padStart(2, "0") : String(date.getHours() % 12 || 12);
  return `${hours}:${minutes}`;
}
