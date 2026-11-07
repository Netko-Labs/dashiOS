/**
 * The tape: the sums worked out, newest at the top, beside the keypad. Its
 * head shares the window controls' strip (one chrome row), with Clear at its
 * end. A click on a row puts its result in the line at the caret; a
 * right-click offers the result and the sum, to use or copy.
 */

import { Button, MENU_SEPARATOR, type MenuEntry, useColors, useSurface } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import { formatResult } from "./format.ts";
import { TAPE_WIDTH } from "./layout.ts";
import { shownExpression, type TapeEntry } from "./line.ts";
import type { NumberLocale } from "./locale.ts";

/** A menu to open at a point in the window. */
export interface MenuAt {
  x: number;
  y: number;
  items: MenuEntry[];
}

export interface TapeProps {
  tape: readonly TapeEntry[];
  locale: NumberLocale;
  /** The window controls' strip: the head is as tall. */
  headHeight: number;
  canCopy: boolean;
  onUse: (entry: TapeEntry) => void;
  onEdit: (index: number) => void;
  onCopy: (text: string) => void;
  onCopyResult: (entry: TapeEntry) => void;
  onClear: () => void;
  onMenu: (menu: MenuAt) => void;
}

function TapeRow({ entry, locale, onPress, onMenu }: { entry: TapeEntry; locale: NumberLocale; onPress: () => void; onMenu: (x: number, y: number) => void }) {
  const colors = useColors();
  const sum = shownExpression(entry.expression, locale);
  const result = `= ${formatResult(entry.value, locale)}`;
  return (
    <View
      onPress={onPress}
      onContextMenu={(point) => onMenu(point.x, point.y)}
      accessibilityRole="button"
      accessibilityLabel={`${sum} ${result}`}
      style={{
        // Stretched, so each line has the row's width to sit at the right of (and the sum to wrap in).
        flexDirection: "column",
        alignItems: "stretch",
        gap: 2,
        paddingVertical: 7,
        paddingHorizontal: 10,
        borderRadius: 7,
        hoverBackgroundColor: colors.button,
      }}
    >
      <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "right" }}>
        {sum}
      </Text>
      <Text numberOfLines={1} style={{ fontSize: 15, color: colors.text, textAlign: "right" }}>
        {result}
      </Text>
    </View>
  );
}

export function Tape({ tape, locale, headHeight, canCopy, onUse, onEdit, onCopy, onCopyResult, onClear, onMenu }: TapeProps) {
  const colors = useColors();
  const surface = useSurface();
  const menuFor = (entry: TapeEntry, index: number): MenuEntry[] => [
    { label: "Use Result", onPress: () => onUse(entry) },
    { label: "Edit Sum", onPress: () => onEdit(index) },
    MENU_SEPARATOR,
    { label: "Copy Result", disabled: !canCopy, onPress: () => onCopyResult(entry) },
    { label: "Copy Sum", disabled: !canCopy, onPress: () => onCopy(shownExpression(entry.expression, locale)) },
    MENU_SEPARATOR,
    { label: "Clear Tape", onPress: onClear },
  ];
  return (
    <View
      testID="tape"
      style={{ width: TAPE_WIDTH, flexShrink: 0, flexDirection: "column", backgroundColor: surface.sidebar, borderLeftWidth: 1, borderColor: colors.separator }}
    >
      <View
        dragRegion
        style={{ height: Math.max(headHeight, 38), flexShrink: 0, flexDirection: "row", alignItems: "center", paddingLeft: 14, paddingRight: 8 }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>Tape</Text>
        </View>
        {tape.length > 0 && <Button testID="tape-clear" label="Clear" onPress={onClear} focusable={false} />}
      </View>
      {tape.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 }}>
          <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>Sums you work out show up here.</Text>
        </View>
      ) : (
        <ScrollView testID="tape-rows" style={{ flex: 1, flexDirection: "column", paddingHorizontal: 6, paddingBottom: 8 }}>
          {tape
            .map((entry, index) => ({ entry, index }))
            .reverse()
            .map(({ entry, index }) => (
              <TapeRow
                key={String(index)}
                entry={entry}
                locale={locale}
                onPress={() => onUse(entry)}
                onMenu={(x, y) => onMenu({ x, y, items: menuFor(entry, index) })}
              />
            ))}
        </ScrollView>
      )}
    </View>
  );
}
