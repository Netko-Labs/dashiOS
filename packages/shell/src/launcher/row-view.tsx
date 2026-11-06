/**
 * One launcher row and one section head, on Dashi's measures (docs/design.html
 * LA-1, TY-1, RA-1): rows 40 tall with 28 px icons, a 7 px radius inside the
 * panel's 5 px padding and 12 px corners, the name at 13, what follows it at
 * 12, the kind at 11, all times the person's text size (measures.ts). One
 * line each (VS-2). The selected row is a kombu wash behind ink, with a 3 px
 * kombu bar at its left edge (CO-6).
 *
 * At the right end a row shows one thing: a setting's control (its switch,
 * which Space flips, or its value), else the key that does it (a menu
 * item's shortcut, a verb's key, the digit ❖ picks it with while ❖ is held),
 * else its kind. Keys are drawn as glyphs (@dashi/ui Shortcut).
 */

import { KEY_GLYPHS, Shortcut, Switch, useColors } from "@dashi/ui";
import { Image, Svg, Text, View } from "@mirinjs/metal";
import { type Measures, STANDARD, useMeasures } from "./measures.ts";
import type { Row, RowIcon } from "./rows.ts";

export const ROW_HEIGHT = STANDARD.row;
export const HEAD_HEIGHT = STANDARD.head;
const BAR = { width: 3, height: 20 };
/** Left of a row's name: its padding, icon, and the gap after it. */
export const nameIndent = (m: Measures): number => 10 + m.icon + 10;

function Icon({ icon, m }: { icon: RowIcon; m: Measures }) {
  const colors = useColors();
  if ("none" in icon) return null;
  if ("image" in icon) return <Image source={icon.image} style={{ width: m.icon, height: m.icon }} />;
  // A pane's own glyph in ink on a neutral tile: never tinted (CO-2, CO-4).
  return (
    <View
      style={{ width: m.icon, height: m.icon, borderRadius: m.icon * 0.24, alignItems: "center", justifyContent: "center", backgroundColor: colors.button }}
    >
      <Svg markup={icon.glyph} size={m.glyph} color={colors.text} />
    </View>
  );
}

export interface ResultRowProps {
  row: Row;
  selected: boolean;
  onPress: () => void;
  onHover: () => void;
  /** Right-click: the row's action list. */
  onContextMenu?: () => void;
  /** ❖ is held: the digit that picks this row (1–9). */
  digit?: number;
  /** Props for the accessibility tree (access.ts); none on a host without one. */
  access?: Record<string, unknown>;
}

/** What the right end shows (see the module comment). */
function RightEnd({ row, digit, quiet, m }: { row: Row; digit: number | undefined; quiet: string; m: Measures }) {
  if (digit !== undefined) return <Shortcut keys={`❖${digit}`} color={quiet} size={m.small} />;
  if (row.control?.kind === "switch") return <Switch testID={`launcher:switch:${row.id}`} on={row.control.on} />;
  if (row.control?.kind === "value") return <Text style={{ fontSize: m.detail, color: quiet }}>{row.control.text}</Text>;
  if (row.shortcut) return <Shortcut keys={row.shortcut} color={quiet} size={m.small} />;
  if (row.kind !== "") return <Text style={{ fontSize: m.small, color: quiet }}>{row.kind}</Text>;
  return null;
}

export function ResultRow({ row, selected, onPress, onHover, onContextMenu, digit, access }: ResultRowProps) {
  const colors = useColors();
  const m = useMeasures();
  // On the wash every word is ink: muted ink there would fall under 4.5:1. A destructive row stays red, selected or not.
  const ink = row.danger ? colors.criticalInk : selected ? colors.onSelection : colors.text;
  const quiet = selected ? colors.onSelection : colors.textMuted;
  return (
    <View
      testID={`launcher:row:${row.id}`}
      onPress={onPress}
      onHoverChange={(hovered) => {
        if (hovered) onHover();
      }}
      {...(onContextMenu ? { onContextMenu } : {})}
      {...(access ?? {})}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        height: m.row,
        paddingLeft: 10,
        paddingRight: 12,
        borderRadius: 7,
        // One mark only: the pointer moves the selection, so a row has no hover tint of its own.
        ...(selected ? { backgroundColor: colors.selectionWash } : {}),
      }}
    >
      {selected && (
        <View
          style={{
            position: "absolute",
            left: 0,
            top: (m.row - BAR.height) / 2,
            width: BAR.width,
            height: BAR.height,
            borderRadius: 1.5,
            backgroundColor: colors.selectionBar,
          }}
        />
      )}
      <Icon icon={row.icon} m={m} />
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flexShrink: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: m.title, color: ink, ...(row.strong ? { fontWeight: "semibold" } : {}) }}>
            {row.title}
          </Text>
        </View>
        {row.chord !== undefined && <Shortcut keys={row.chord} color={ink} size={m.detail} />}
        {row.badge !== undefined && (
          <View
            testID={`launcher:badge:${row.id}`}
            style={{
              flexShrink: 0,
              paddingLeft: 5,
              paddingRight: 5,
              height: Math.round(m.small * 1.45),
              borderRadius: 4,
              justifyContent: "center",
              backgroundColor: colors.button,
            }}
          >
            <Text style={{ fontSize: m.small, color: ink }}>{row.badge}</Text>
          </View>
        )}
        {row.detail !== undefined && (
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: m.detail, color: quiet }}>
              {row.detail}
            </Text>
          </View>
        )}
      </View>
      <RightEnd row={row} digit={digit} quiet={quiet} m={m} />
      {row.more && <Svg markup={KEY_GLYPHS["→"] ?? ""} size={m.detail} color={quiet} />}
    </View>
  );
}

/** Slots held for rows still coming: the panel keeps its height, and the rows fill in without moving anything. */
export function ReservedRows({ count }: { count: number }) {
  const m = useMeasures();
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={{ height: m.row }} />
      ))}
    </>
  );
}

export function SectionHead({ title, aside }: { title: string; aside?: string }) {
  const colors = useColors();
  const m = useMeasures();
  return (
    <View style={{ height: m.head, flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 12, gap: 8 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: m.small, fontWeight: "semibold", color: colors.textMuted }}>
          {title}
        </Text>
      </View>
      {aside !== undefined && <Text style={{ fontSize: m.small, color: colors.textMuted }}>{aside}</Text>}
    </View>
  );
}
