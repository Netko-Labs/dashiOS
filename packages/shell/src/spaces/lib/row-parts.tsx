/**
 * The parts the Desktops row draws (row.tsx): a picture's frame, a name, the
 * rename field that replaces a name, the × on a name, and the +. Each is a
 * plain view of what row.tsx decides; none keeps state of its own.
 */

import { useColors } from "@dashi/ui";
import { Text, TextInput, View } from "@mirinjs/metal";
import { useRef } from "react";
import type { Rect } from "./row-layout.ts";
import { lifted } from "./shelf.ts";

/** The × on a name: its size, and how far it hangs over the name's corner. */
export const CLOSE = 20;
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
        onPress={() => props.onSwitch(index)}
        onHoverChange={(over) => props.onOverSpace(index, over)}
        style={{
          ...at({ x: rect.x - RING, y: rect.y - RING, width: rect.width + 2 * RING, height: rect.height + 2 * RING }),
          borderRadius: 8,
          borderWidth: RING,
          borderColor: index === props.current || props.lifted === index ? colors.selection : colors.dockBorder,
          shadow: props.lifted === index ? "xl" : "md",
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
        paddingHorizontal: 10,
        // Room for the × at the left end while it shows, so it never covers the name.
        paddingLeft: props.showsClose ? CLOSE : 10,
        borderRadius: rect.height / 2,
        backgroundColor: isCurrent ? colors.launcher : colors.dock,
        borderWidth: isCurrent ? 2 : 1,
        borderColor: isCurrent ? colors.selection : colors.dockBorder,
        shadow: "md",
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: isCurrent ? "semibold" : "normal", color: colors.text, textAlign: "center" }}>
        {props.label}
      </Text>
    </View>
  );
}

/** A name being edited in place: Return keeps it (onSubmit), Esc puts it back (onCancel). */
export function RenameField(props: { index: number; rect: Rect; text: string; onChange(text: string): void; onSubmit(text: string): void; onCancel(): void }) {
  const colors = useColors();
  const { rect } = props;
  return (
    <View style={{ ...at(rect), justifyContent: "center" }}>
      <TextInput
        testID={`space-${props.index + 1}-name`}
        value={props.text}
        autoFocus
        onChangeText={props.onChange}
        onSubmitEditing={props.onSubmit}
        onKeyPress={(key) => key === "Escape" && props.onCancel()}
        style={{
          width: rect.width,
          height: rect.height,
          fontSize: 13,
          color: colors.text,
          backgroundColor: colors.launcher,
          borderRadius: rect.height / 2,
          borderColor: colors.selection,
          padding: 6,
        }}
      />
    </View>
  );
}

/** The × on a name: removes that Desktop. */
export function RowClose(props: { testID: string; rect: Rect; onPress(): void; onHoverChange(over: boolean): void }) {
  const colors = useColors();
  const { rect } = props;
  return (
    <View
      testID={props.testID}
      occlude
      onPress={props.onPress}
      onHoverChange={props.onHoverChange}
      style={{
        ...at({ x: rect.x - CLOSE / 4, y: rect.y - CLOSE / 4, width: CLOSE, height: CLOSE }),
        borderRadius: CLOSE / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.osdOn,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: "bold", color: colors.menu }}>×</Text>
    </View>
  );
}

/** The + at the row's right end: a new Desktop. */
export function RowAdd(props: { rect: Rect; onPress(): void }) {
  const colors = useColors();
  const { rect } = props;
  return (
    <View
      testID="space-add"
      onPress={props.onPress}
      style={{
        ...at(rect),
        borderRadius: Math.min(rect.width, rect.height) / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.dock,
        borderWidth: 1,
        borderColor: colors.dockBorder,
        shadow: "md",
      }}
    >
      <Text style={{ fontSize: 20, color: colors.text }}>+</Text>
    </View>
  );
}
