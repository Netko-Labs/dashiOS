/**
 * Dashi's own widgets, as the gallery lists them: each one's name, ink,
 * glyph and sizes. An outside extension's widgets are added beside these
 * from its manifest (extension-widgets.ts) and always print in plain ink:
 * `category` is honoured for first-party widgets only (round five, #30).
 */

import { INKS } from "@dashi/ui";
import type { WidgetInfo, WidgetKind, WidgetSize } from "./types.ts";

export const DASHI_WIDGETS: readonly WidgetInfo[] = [
  { kind: "rundown", name: "Rundown", ink: null, glyph: "cal", sizes: ["large", "wide"], holdsPrivate: true, blurb: "Your day in time order, one row a thing" },
  { kind: "clock", name: "Clock", ink: null, glyph: "timer", sizes: ["small", "mini", "compact"], holdsPrivate: false, blurb: "The time, large" },
  { kind: "world", name: "World Clocks", ink: null, glyph: "globe", sizes: ["wide", "small"], holdsPrivate: false, blurb: "The time in the cities you add" },
  { kind: "calendar", name: "Calendar", ink: "miso", glyph: "cal", sizes: ["small", "wide", "large"], holdsPrivate: true, blurb: "Today and what is next" },
  { kind: "weather", name: "Weather", ink: "mizu", glyph: "partly", sizes: ["small", "compact", "wide"], holdsPrivate: false, blurb: "Now, and the next hours" },
  { kind: "battery", name: "Battery", ink: "matcha", glyph: "bolt", sizes: ["small", "compact"], holdsPrivate: false, blurb: "Charge, and how long it lasts" },
  { kind: "system", name: "System", ink: null, glyph: "cpu", sizes: ["small", "wide"], holdsPrivate: false, blurb: "Processor, memory and graphics" },
  { kind: "media", name: "Music", ink: "album", glyph: "music", sizes: ["wide", "small"], holdsPrivate: false, blurb: "What is playing, in the sleeve's colour" },
  { kind: "timer", name: "Timer", ink: "wakame", glyph: "timer", sizes: ["small", "compact", "wide"], holdsPrivate: false, blurb: "Start one in a press" },
  { kind: "notes", name: "Notes", ink: null, glyph: "note", sizes: ["small", "wide"], holdsPrivate: true, blurb: "Your latest note" },
  { kind: "agents", name: "Agents", ink: "shiso", glyph: "spark", sizes: ["small", "wide"], holdsPrivate: true, blurb: "What your agents are doing" },
];

/** What the gallery says under a widget: "prints in mizu" (the ink's name appears only while editing, #19). */
export function printsIn(info: WidgetInfo): string {
  return info.ink === null ? "prints in plain ink" : `prints in ${info.ink}`;
}

/** The tag while resizing: "Weather · mizu · Small → Wide". */
export function resizeTag(info: WidgetInfo, from: WidgetSize, to: WidgetSize): string {
  const word = (size: WidgetSize) => size.charAt(0).toUpperCase() + size.slice(1);
  return [info.name, ...(info.ink ? [info.ink] : []), `${word(from)} → ${word(to)}`].join(" · ");
}

/** A kind's information, Dashi's or an extension's; null for one that is no longer there. */
export function widgetInfo(kind: WidgetKind, extensions: readonly WidgetInfo[] = []): WidgetInfo | null {
  return DASHI_WIDGETS.find((info) => info.kind === kind) ?? extensions.find((info) => info.kind === kind) ?? null;
}

/** The ink's category name for the gallery ("Weather"). */
export function inkWhat(info: WidgetInfo): string {
  return info.ink ? INKS[info.ink].what : "";
}
