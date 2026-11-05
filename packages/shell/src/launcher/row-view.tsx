/**
 * One launcher row and one section head, on Dashi's measures (docs/design.html
 * LA-1, TY-1, RA-1): rows 40 tall with 28 px icons, a 7 px radius inside the
 * panel's 5 px padding and 12 px corners, the name at 13, what follows it at
 * 12, the kind at 11. One line each (VS-2). The selected row is a kombu wash
 * behind ink, with a 3 px kombu bar at its left edge (CO-6).
 */

import { KEY_GLYPHS, useColors } from "@dashi/ui";
import { Image, Svg, Text, View } from "@mirinjs/metal";
import type { Row, RowIcon } from "./rows.ts";

export const ROW_HEIGHT = 40;
export const HEAD_HEIGHT = 22;
const ICON = 28;
const BAR = { width: 3, height: 20 };

function Icon({ icon }: { icon: RowIcon }) {
  const colors = useColors();
  if ("image" in icon) return <Image source={icon.image} style={{ width: ICON, height: ICON }} />;
  // A pane's own glyph in ink on a neutral tile: never tinted (CO-2, CO-4).
  return (
    <View style={{ width: ICON, height: ICON, borderRadius: 6.7, alignItems: "center", justifyContent: "center", backgroundColor: colors.button }}>
      <Svg markup={icon.glyph} size={16} color={colors.text} />
    </View>
  );
}

export function ResultRow({ row, selected, onPress, onHover }: { row: Row; selected: boolean; onPress: () => void; onHover: () => void }) {
  const colors = useColors();
  // On the wash every word is ink: muted ink there would fall under 4.5:1.
  const ink = selected ? colors.onSelection : colors.text;
  const quiet = selected ? colors.onSelection : colors.textMuted;
  return (
    <View
      testID={`launcher:row:${row.id}`}
      onPress={onPress}
      onHoverChange={(hovered) => {
        if (hovered) onHover();
      }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        height: ROW_HEIGHT,
        paddingLeft: 10,
        paddingRight: 12,
        borderRadius: 7,
        ...(selected ? { backgroundColor: colors.selectionWash } : { hoverBackgroundColor: colors.hover }),
      }}
    >
      {selected && (
        <View
          style={{
            position: "absolute",
            left: 0,
            top: (ROW_HEIGHT - BAR.height) / 2,
            width: BAR.width,
            height: BAR.height,
            borderRadius: 1.5,
            backgroundColor: colors.selectionBar,
          }}
        />
      )}
      <Icon icon={row.icon} />
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flexShrink: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, color: ink, ...(row.strong ? { fontWeight: "semibold" } : {}) }}>
            {row.title}
          </Text>
        </View>
        {row.detail !== undefined && (
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 12, color: quiet }}>
              {row.detail}
            </Text>
          </View>
        )}
      </View>
      {row.kind !== "" && <Text style={{ fontSize: 11, color: quiet }}>{row.kind}</Text>}
      {row.more && <Svg markup={KEY_GLYPHS["→"] ?? ""} size={12} color={quiet} />}
    </View>
  );
}

/** Slots held for rows still coming: the panel keeps its height, and the rows fill in without moving anything. */
export function ReservedRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={{ height: ROW_HEIGHT }} />
      ))}
    </>
  );
}

export function SectionHead({ title, aside }: { title: string; aside?: string }) {
  const colors = useColors();
  return (
    <View style={{ height: HEAD_HEIGHT, flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 12, gap: 8 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: "semibold", color: colors.textMuted }}>
          {title}
        </Text>
      </View>
      {aside !== undefined && <Text style={{ fontSize: 11, color: colors.textMuted }}>{aside}</Text>}
    </View>
  );
}
