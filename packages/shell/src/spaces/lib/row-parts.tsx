/**
 * The parts the Desktops row draws (row.tsx): a picture's frame, a name, the
 * rename field that replaces a name, the × on a name, and the +. Each is a
 * plain view of what row.tsx decides; none keeps state of its own. They
 * sit on the row's thin glass: a name is a fill, the current one the
 * accent's wash (frost-objects board 13, D781).
 */

import { ADD, CLOSE as CLOSE_GLYPH, GLYPH_BUTTON, GlyphButton, pill, RADIUS, SHADOW, SPACE, TextField, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useRef } from "react";
import type { Rect } from "./row-layout.ts";
import { lifted } from "./shelf.ts";

/** The × on a name: its size (the kit's small glyph button), and how far it hangs over the name's corner. */
export const CLOSE = GLYPH_BUTTON.small.target;
/** A second press on a name this soon is a double-click: rename instead of going there. */
const DOUBLE_CLICK_MS = 350;
/** The frame around a picture, outside it (the picture covers the inside). */
export const RING = 2;

export const at = (rect: Rect) => ({ position: "absolute" as const, left: rect.x, top: rect.y, width: rect.width, height: rect.height });

/**
 * A press on a name goes to that Desktop after a moment, unless a second
 * press comes first: a double-click renames it. A full-screen Desktop is
 * named after its app, so its double-click is two presses and goes there.
 */
export function useNamePress(
  onSwitch: (index: number) => void,
  rename: (index: number) => void,
  isFullscreen: (index: number) => boolean,
): (index: number) => void {
  const lastPress = useRef<{ index: number; at: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  return (index) => {
    const last = lastPress.current;
    if (last) clearTimeout(last.timer);
    if (last && last.index === index && Date.now() - last.at < DOUBLE_CLICK_MS && !isFullscreen(index)) {
      lastPress.current = null;
      rename(index);
      return;
    }
    lastPress.current = { index, at: Date.now(), timer: setTimeout(() => onSwitch(index), DOUBLE_CLICK_MS) };
  };
}

/** The live pictures of the Desktops, framed; the lifted one (a dragged window is over it) is raised. */
export function RowPictures(props: {
  pictures: readonly Rect[];
  /** Each Desktop's name, for screen readers and agents. */
  names: readonly string[];
  lifted: number | null;
  current: number;
  onSwitch(index: number): void;
  onOverSpace(index: number, over: boolean): void;
}) {
  const colors = useColors();
  return props.pictures.map((picture, index) => {
    const rect = props.lifted === index ? lifted(picture) : picture;
    return (
      <View
        key={`picture-${index}`}
        testID={`space-${index + 1}-picture`}
        accessibilityRole="option"
        accessibilityLabel={props.names[index] || `Desktop ${index + 1}`}
        accessibilityState={{ selected: index === props.current }}
        onPress={() => props.onSwitch(index)}
        onHoverChange={(over) => props.onOverSpace(index, over)}
        style={{
          ...at({ x: rect.x - RING, y: rect.y - RING, width: rect.width + 2 * RING, height: rect.height + 2 * RING }),
          borderRadius: RADIUS.control,
          borderWidth: RING,
          borderColor: index === props.current || props.lifted === index ? colors.selection : colors.dockBorder,
          shadow: props.lifted === index ? SHADOW.xl : SHADOW.sm,
        }}
      />
    );
  });
}

/** One Desktop's name, on its tile; the current one is marked. */
export function RowName(props: {
  testID: string;
  rect: Rect;
  label: string;
  isCurrent: boolean;
  showsClose: boolean;
  onPress(): void;
  onHoverChange(over: boolean): void;
}) {
  const colors = useColors();
  const { rect, isCurrent } = props;
  return (
    <View
      testID={props.testID}
      onPress={props.onPress}
      onHoverChange={props.onHoverChange}
      style={{
        ...at(rect),
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: SPACE.gap,
        // Room for the × at the left end while it shows, so it never covers the name.
        paddingLeft: props.showsClose ? CLOSE : SPACE.gap,
        borderRadius: rect.height / 2,
        backgroundColor: isCurrent ? colors.selectionWash : colors.button,
        hoverBackgroundColor: isCurrent ? colors.selectionWash : colors.tileHover,
      }}
    >
      <Text
        numberOfLines={1}
        style={{ fontSize: TYPE.body.size, fontWeight: isCurrent ? WEIGHT.semibold : WEIGHT.regular, color: colors.text, textAlign: "center" }}
      >
        {props.label}
      </Text>
    </View>
  );
}

/** A name being edited in place, in the kit's field (its edge the focus purple while it has the keyboard, SH-28): Return keeps it (onSubmit), Esc puts it back (onCancel). */
export function RowRename(props: { index: number; rect: Rect; text: string; onChange(text: string): void; onSubmit(text: string): void; onCancel(): void }) {
  const { rect } = props;
  return (
    <View style={{ ...at(rect), justifyContent: "center" }}>
      <TextField
        testID={`space-${props.index + 1}-name`}
        value={props.text}
        width={rect.width}
        autoFocus
        onChangeText={props.onChange}
        onSubmit={props.onSubmit}
        onKeyPress={(key) => key === "Escape" && props.onCancel()}
      />
    </View>
  );
}

/** The × on a name: removes that Desktop. A glyph (IC-3), not the font's ×. */
export function RowClose(props: { testID: string; rect: Rect; onPress(): void; onHoverChange(over: boolean): void }) {
  const { rect } = props;
  return (
    <View
      occlude
      onHoverChange={props.onHoverChange}
      style={{ ...at({ x: rect.x - CLOSE / 4, y: rect.y - CLOSE / 4, width: CLOSE, height: CLOSE }), alignItems: "center", justifyContent: "center" }}
    >
      <GlyphButton testID={props.testID} glyph={CLOSE_GLYPH} label="Remove Desktop" size="small" filled onPress={props.onPress} />
    </View>
  );
}

/** The + at the row's right end: a new Desktop, its glyph on a fill of the row's glass. */
export function RowAdd(props: { rect: Rect; onPress(): void }) {
  const colors = useColors();
  const { rect } = props;
  return (
    <View
      onPress={props.onPress}
      style={{
        ...at(rect),
        borderRadius: pill(Math.min(rect.width, rect.height)),
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.button,
      }}
    >
      <GlyphButton testID="space-add" glyph={ADD} label="New Desktop" onPress={props.onPress} />
    </View>
  );
}
