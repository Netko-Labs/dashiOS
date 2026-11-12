/**
 * A window's title in its toolbar (`AppWindow`): the name in bold, and after
 * it on the same line a short word about it, muted ("All Notes — 3 notes").
 * One line, always (VS-2). It takes the room the toolbar's controls leave,
 * and gives way in this order:
 *
 * - the detail first: a long one is cut with an ellipsis down to
 *   `DETAIL_KEEP`; with less room than that (or than a short one needs
 *   whole) it is not shown, never a bare "…";
 * - then a field in the toolbar that shrinks (a search field): the title
 *   keeps its own width, up to `TITLE_KEEP`, before the field gives any;
 * - then the title, cut with an ellipsis.
 */

import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { useColors } from "./theme/index.ts";

/** The widest a window's title gets in its toolbar before it is cut. */
export const TITLE_MAX = 320;
/** The least room the title's row keeps, whatever the title. */
export const TITLE_MIN = 96;
/** A title up to this wide is never cut while a field in the toolbar can still shrink ("Choose a folder"). */
export const TITLE_KEEP = 128;
/** The title's line: its height, and the height of the row that holds it and its detail. */
const TITLE_LINE = 18;
/** The least of a detail worth showing: a shorter one shows whole or not at all, a longer one is cut no shorter. */
const DETAIL_KEEP = 120;

/** The room the title's row keeps for a title `width` wide: the title whole, between `TITLE_MIN` and `TITLE_KEEP`. */
export function titleRoom(width: number): number {
  return Math.min(TITLE_KEEP, Math.max(TITLE_MIN, Math.ceil(width)));
}

export function WindowTitle({ title, detail }: { title: string; detail?: string }) {
  const colors = useColors();
  // The title's own width, measured by an unseen copy: Metal sizes a view that grows from nothing.
  const [width, setWidth] = useState(0);
  const name = { fontSize: 13, lineHeight: TITLE_LINE, fontWeight: "bold", color: colors.text } as const;
  return (
    <View testID="window-title" style={{ flex: 1, minWidth: titleRoom(width), flexDirection: "row", alignItems: "center", position: "relative" }}>
      <View style={{ position: "absolute", left: 0, top: 0, width: TITLE_KEEP, height: 0, overflow: "hidden", opacity: 0, flexDirection: "row" }}>
        <View testID="window-title-room" onLayout={(bounds) => setWidth((was) => (Math.abs(was - bounds.width) < 0.5 ? was : bounds.width))}>
          <Text numberOfLines={1} style={name}>
            {title}
          </Text>
        </View>
      </View>
      {/* One line that wraps, a line tall: a detail with no room goes to a second line nobody sees. */}
      <View style={{ flex: 1, minWidth: 0, height: TITLE_LINE, flexDirection: "row", flexWrap: "wrap", overflow: "hidden" }}>
        <View style={{ flexShrink: 1, minWidth: 0, maxWidth: TITLE_MAX }}>
          <Text numberOfLines={1} style={name}>
            {title}
          </Text>
        </View>
        {detail ? <TitleDetail text={` — ${detail}`} color={colors.textMuted} /> : null}
      </View>
    </View>
  );
}

/**
 * The title's detail. Its place in the row is as wide as its words, up to `DETAIL_KEEP` (the
 * unseen copy measures them); it grows into what the title leaves, and the words are cut to
 * that. When the row has less than its place, the row wraps it out of sight (review 0.8: Notes'
 * "— 1 note" was cut to a bare "…" in a narrow window).
 */
function TitleDetail({ text, color }: { text: string; color: string }) {
  const style = { fontSize: 13, lineHeight: TITLE_LINE, color };
  return (
    <View testID="window-title-detail" style={{ flexGrow: 1, flexShrink: 0, minWidth: 0, height: TITLE_LINE, position: "relative" }}>
      <View testID="window-title-detail-room" style={{ maxWidth: DETAIL_KEEP, height: 0, overflow: "hidden", opacity: 0 }}>
        <Text numberOfLines={1} style={style}>
          {text}
        </Text>
      </View>
      <View style={{ position: "absolute", left: 0, right: 0, top: 0 }}>
        <Text numberOfLines={1} style={style}>
          {text}
        </Text>
      </View>
    </View>
  );
}
