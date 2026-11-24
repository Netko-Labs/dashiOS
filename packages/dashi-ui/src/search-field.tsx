/**
 * The one search field (UI-11): a list's filter or a Find, at the toolbar's
 * end. 28 tall at radius 7 on the button's wash (the panel look: a 28 pill),
 * a 15 magnifier over its start, its own focus edge. In a toolbar it is 210,
 * shrinking to 96 before anything else gives way (VS-7). Its placeholder
 * says what it searches ("Search apps"), becomes "Search" once the field
 * has shrunk, and ends in an ellipsis when even that doesn't fit: never cut
 * mid-word. A clear button shows once something is typed.
 *
 * A search (the default) empties itself on the first Esc, as on the Mac. A
 * find (`variant="find"`) keeps its query on Esc and passes the key on at
 * once: the app hands the keyboard back to the document. `status` is a few
 * muted words at its end about what it found ("2 of 4").
 */

import { type Bounds, Svg, Text, TextInput, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import type { Look } from "./button.tsx";
import { CLEAR as CLEAR_GLYPH, SEARCH } from "./glyphs.ts";
import { useControlColors } from "./panel/index.ts";
import { CLEAR, pill, RADIUS, SPACE, TYPE, useColors } from "./theme/index.ts";

/** The field's measures (VS-7, UI-11): 210 wide, shrinking to 96; the placeholder turns short under 140. */
export const SEARCH_FIELD = { width: 210, least: 96, shortBelow: 140, height: 28, glyph: 15, inset: SPACE.m, gap: SPACE.s, clear: 18 } as const;

/** What the placeholder says at a width: its own words, or "Search" once shrunk. */
export function placeholderAt(placeholder: string, width: number): string {
  return width > 0 && width < SEARCH_FIELD.shortBelow ? "Search" : placeholder;
}

export interface SearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  testID: string;
  /** "Search ‹what›". */
  placeholder?: string;
  width?: number;
  /** With it, the field shrinks toward this width when its toolbar row is short of room; without, it keeps `width`. */
  minWidth?: number;
  autoFocus?: boolean;
  /** "search" (default): Esc empties the field first. "find": Esc leaves the query and goes to `onKeyPress`. */
  variant?: "search" | "find";
  onKeyPress?: (key: "Escape" | "ArrowUp" | "ArrowDown") => void;
  onSubmit?: (text: string) => void;
  /** Muted words at the field's end, before the clear button: Find's place ("2 of 4", "Not found"). */
  status?: string | null;
  look?: Look;
  /** Take the row's room (Files' omnibox in the title's place), never under `minWidth`. */
  fill?: boolean;
  /** The glyph over its start, in place of the magnifier (a folder while a path is typed). */
  glyph?: string;
  /** Controls at its end, before the status and the clear button (where a search looks). */
  accessory?: ReactNode;
  /** What the clear button does besides emptying the field. */
  onClear?: () => void;
  /**
   * The field at rest, as something else in the same box (Files' crumbs): no text
   * input, the box pressable and the window's Tab stop; a press, Space or Return
   * calls `onPressRest`, which gives the text back. Named by `restLabel`.
   */
  rest?: ReactNode;
  onPressRest?: () => void;
  restLabel?: string;
  /** The box's bounds, for a list hung under it (suggestions). */
  onLayout?: (bounds: Bounds) => void;
}

export function SearchField({
  value,
  onChangeText,
  testID,
  placeholder = "Search",
  width = SEARCH_FIELD.width,
  minWidth,
  autoFocus,
  variant = "search",
  onKeyPress,
  onSubmit,
  status,
  look = "window",
  fill,
  glyph = SEARCH,
  accessory,
  onClear,
  rest,
  onPressRest,
  restLabel,
  onLayout,
}: SearchFieldProps) {
  const colors = useColors();
  const panel = useControlColors();
  const m = SEARCH_FIELD;
  const [laid, setLaid] = useState(0);
  const [trailing, setTrailing] = useState(0);
  const lead = m.inset + m.glyph + m.gap;
  const ground = look === "panel" ? panel.off : colors.button;
  const size = look === "panel" ? TYPE.panel.body.size : TYPE.body.size;
  const words = placeholderAt(placeholder, laid);
  const radius = look === "panel" ? pill(m.height) : RADIUS.control;
  const box = fill
    ? { flex: 1, minWidth: minWidth ?? m.least, height: m.height }
    : { width, height: m.height, ...(minWidth === undefined ? { flexShrink: 0 as const } : { flexShrink: 1 as const, minWidth }) };
  const laidOut = (bounds: Bounds): void => {
    setLaid((was) => (Math.abs(was - bounds.width) < 0.5 ? was : bounds.width));
    onLayout?.(bounds);
  };
  if (rest !== undefined) {
    return (
      <View
        testID={testID}
        onLayout={laidOut}
        focusable
        accessibilityRole="button"
        accessibilityLabel={restLabel ?? placeholder}
        onPress={onPressRest}
        style={{
          ...box,
          flexDirection: "row",
          alignItems: "center",
          gap: SPACE.xxs,
          paddingLeft: SPACE.xs,
          paddingRight: SPACE.m,
          borderRadius: radius,
          backgroundColor: ground,
          focusRingColor: colors.focusRing,
        }}
      >
        {rest}
      </View>
    );
  }
  return (
    <View onLayout={laidOut} style={{ ...box, flexDirection: "row", position: "relative" }}>
      <TextInput
        testID={testID}
        value={value}
        accessibilityLabel={placeholder}
        autoFocus={autoFocus}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        onKeyPress={(key) => {
          // A search's Esc empties the field first, as on the Mac; a find's leaves it.
          if (key === "Escape" && value !== "" && variant === "search") onChangeText("");
          else onKeyPress?.(key);
        }}
        style={{
          flex: 1,
          height: m.height,
          padding: SPACE.xs,
          paddingLeft: lead,
          paddingRight: SPACE.xs + trailing,
          fontSize: size,
          borderRadius: radius,
          color: colors.text,
          backgroundColor: ground,
          borderColor: CLEAR,
          focusBorderColor: colors.focusRing,
        }}
      />
      <Lead testID={testID} glyph={glyph} words={value === "" ? words : null} size={size} right={SPACE.xs + trailing} />
      <Trailing
        testID={testID}
        value={value}
        status={status}
        accessory={accessory}
        onClear={() => {
          onChangeText("");
          onClear?.();
        }}
        onWidth={(width) => setTrailing((was) => (Math.abs(was - width) < 0.5 ? was : width))}
      />
    </View>
  );
}

/** What sits at the field's end: its status in muted words, and the clear button once something is typed. */
function Trailing({
  testID,
  value,
  status,
  accessory,
  onClear,
  onWidth,
}: {
  testID: string;
  value: string;
  status?: string | null;
  accessory?: ReactNode;
  onClear: () => void;
  onWidth: (width: number) => void;
}) {
  const colors = useColors();
  const m = SEARCH_FIELD;
  return (
    <View
      onLayout={(bounds) => onWidth(bounds.width)}
      style={{ position: "absolute", right: SPACE.xs, top: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: SPACE.xs }}
    >
      {accessory}
      {status ? (
        <View testID={`${testID}:status`} style={{ flexShrink: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>
            {status}
          </Text>
        </View>
      ) : null}
      {value !== "" && (
        <View
          testID={`${testID}:clear`}
          focusable
          accessibilityRole="button"
          accessibilityLabel="Clear"
          onPress={onClear}
          style={{
            width: m.clear,
            height: m.clear,
            borderRadius: pill(m.clear),
            alignItems: "center",
            justifyContent: "center",
            focusRingColor: colors.focusRing,
          }}
        >
          <Svg markup={CLEAR_GLYPH} size={TYPE.body.size} color={colors.textMuted} />
        </View>
      )}
    </View>
  );
}

/** The magnifier over the field's start, and the placeholder after it while nothing is typed, cut with an ellipsis. */
function Lead({ testID, glyph, words, size, right }: { testID: string; glyph: string; words: string | null; size: number; right: number }) {
  const colors = useColors();
  const m = SEARCH_FIELD;
  return (
    <View style={{ position: "absolute", left: m.inset, top: 0, bottom: 0, right, flexDirection: "row", alignItems: "center", gap: m.gap }}>
      <Svg markup={glyph} size={m.glyph} color={colors.textMuted} />
      {words !== null && (
        <View testID={`${testID}:placeholder`} style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: size, color: colors.textMuted }}>
            {words}
          </Text>
        </View>
      )}
    </View>
  );
}
