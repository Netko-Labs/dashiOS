/**
 * Dashi's controls, in the way the Mac's look: grouped cards of rows (a label,
 * then the control). Choices (choices.tsx), buttons (button.tsx) and glyph
 * tiles (tile.tsx) go in them. They paint with the shell's live palette, so
 * Dark Mode repaints them. System Settings builds its panes from them
 * (settings-app/ui.tsx adds the page and the slider), and so do the
 * first-party apps (apps/kit).
 */

import { Text, View } from "@mirinjs/metal";
import { Children, Fragment, type ReactNode } from "react";
import { Shortcut } from "./shortcut.tsx";
import { useColors, useSurface } from "./theme/index.ts";

/**
 * A sentence pulled 8 closer to the group above it. It keeps the default
 * `flexShrink`: mirin's layout (its vendored taffy 0.9) makes a column
 * shorter by the margin times the child's height when a child with
 * `flexShrink: 0` has a negative margin, and a scroll view that holds the
 * column loses its range. A column as tall as its content never shrinks it.
 */
const TUCK = { marginTop: -8 } as const;

/** A row's inset at both ends, its separators' at the left, and a caption's: one edge for a card's words and its captions'. */
export const ROW_INSET = 12;

/** A heading over a group, or a sentence under it (`TUCK`); `keys` draws a shortcut after it ("⌃❖Q"). */
export function Caption({ children, above, keys }: { children: string; above?: boolean; keys?: string }) {
  const colors = useColors();
  const text = <Text style={{ fontSize: above ? 12 : 11, fontWeight: above ? "semibold" : "normal", color: colors.textMuted }}>{children}</Text>;
  // A shortcut is drawn after the text, not typed into it: text fonts don't reliably carry ❖.
  return (
    // With keys, a row the width of its content, so the shortcut sits right after the text (keep such captions to one line).
    <View
      style={{
        ...(above ? { flexShrink: 0, marginTop: 4 } : TUCK),
        // The rows' inset: a caption's words start where its card's rows' words do.
        paddingHorizontal: ROW_INSET,
        ...(keys ? { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4 } : {}),
      }}
    >
      {text}
      {keys ? <Shortcut keys={keys} color={colors.textMuted} size={11} /> : null}
    </View>
  );
}

/** A card of rows, a hairline between them. */
export function Group({
  children,
  testID,
  wash,
}: {
  children: ReactNode;
  testID?: string /** A color laid over the whole card (Settings lights a card a link lands on). */;
  wash?: string;
}) {
  const colors = useColors();
  const surface = useSurface();
  const rows = Children.toArray(children);
  return (
    <View
      testID={testID}
      style={{
        flexShrink: 0,
        flexDirection: "column",
        borderRadius: 10,
        backgroundColor: surface.card,
        borderWidth: 1,
        borderColor: colors.separator,
        overflow: "hidden",
      }}
    >
      {/* Always there, so lighting the card never remounts its rows. */}
      <View style={{ flexDirection: "column", backgroundColor: wash ?? "#00000000" }}>
        {rows.map((row, index) => (
          // The rows of a group never reorder.
          <Fragment key={index}>
            {index > 0 && <View style={{ height: 1, marginLeft: ROW_INSET, backgroundColor: colors.separator }} />}
            {row}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

/** One line of 13 px text: GPUI's line height is φ times the size (vendor/gpui style.rs). */
const LINE_13 = 21;
/** A row's least height (LA-1). */
const ROW_MIN = 44;

/**
 * A label (and a quieter line under it) with a control at the end; `stack` puts the control under the label.
 * `wraps`: the end is 13 px text that may wrap (a long value in an Info card), so the label sits on its first
 * line, not on the middle of all of them. One line still sits on the row's middle.
 */
export function Row({
  label,
  detail,
  children,
  stack,
  wraps,
  testID,
}: {
  label: string;
  detail?: string;
  children?: ReactNode;
  stack?: boolean;
  wraps?: boolean;
  testID?: string;
}) {
  const colors = useColors();
  const labels = (
    <View style={{ flex: 1, flexDirection: "column", gap: 1, minWidth: 0 }}>
      <Text style={{ fontSize: 13, color: colors.text }}>{label}</Text>
      {detail !== undefined && <Text style={{ fontSize: 11, color: colors.textMuted }}>{detail}</Text>}
    </View>
  );
  if (stack) {
    return (
      <View testID={testID} style={{ flexDirection: "column", gap: 10, padding: ROW_INSET }}>
        {labels}
        {children}
      </View>
    );
  }
  if (wraps) {
    // Top-aligned, with the padding that puts one line on the middle of a least-height row: 11 over, 12 under.
    const over = Math.floor((ROW_MIN - LINE_13) / 2);
    return (
      <View
        testID={testID}
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          gap: 12,
          minHeight: ROW_MIN,
          paddingHorizontal: ROW_INSET,
          paddingTop: over,
          paddingBottom: ROW_MIN - LINE_13 - over,
        }}
      >
        {labels}
        {children}
      </View>
    );
  }
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: ROW_MIN, paddingHorizontal: ROW_INSET, paddingVertical: 8 }}>
      {labels}
      {children}
    </View>
  );
}

/** A line of explanation or of nothing to show. */
export function Note({ children, testID }: { children: string; testID?: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ padding: 16, alignItems: "center" }}>
      <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>{children}</Text>
    </View>
  );
}
