/**
 * The area's ceiling for live items (round five, #23): with more than two,
 * the holder and one standby card show and the rest fold into one row of
 * glyphs and numbers. The order is the tally's: the holder first, then
 * standby newest first.
 */

import type { OnAirItem, TallyView } from "../../tally/index.ts";

/** Which tally items are live cards at the top of the area (music and events stay in their widgets when placed). */
export function liveItems(view: TallyView, placedKinds: readonly string[]): OnAirItem[] {
  const card = (item: OnAirItem): boolean => {
    if (item.key.startsWith("timer:") || item.key.startsWith("run:") || item.key.startsWith("ask:")) return true;
    if (item.key.startsWith("media:")) return !placedKinds.includes("media");
    if (item.key.startsWith("event:")) return !placedKinds.includes("calendar");
    if (item.key.startsWith("weather:")) return !placedKinds.includes("weather");
    return true;
  };
  return [...(view.item ? [view.item] : []), ...view.standby].filter(card);
}

/** At most two cards; with more, the rest fold. */
export function foldLive(items: readonly OnAirItem[]): { cards: OnAirItem[]; folded: OnAirItem[] } {
  if (items.length <= 2) return { cards: [...items], folded: [] };
  return { cards: items.slice(0, 2), folded: items.slice(2) };
}
