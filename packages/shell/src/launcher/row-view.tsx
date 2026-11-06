/**
 * One launcher row and one section head, on Dashi's measures (docs/design.html
 * LA-1, TY-1, RA-1): rows 40 tall with 28 px icons, a 7 px radius inside the
 * panel's 5 px padding and 12 px corners, the name at 13, what follows it at
 * 12, the kind at 11. One line each (VS-2). The selected row is a kombu wash
 * behind ink, with a 3 px kombu bar at its left edge (CO-6).
 *
 * At the right end a row shows one thing: a setting's control (its switch,
 * which Space flips, or its value), else the key that does it (a menu
 * item's shortcut, a verb's key, the digit ❖ picks it with while ❖ is held),
 * else its kind. Keys are drawn as glyphs (@dashi/ui Shortcut).
 */

import { KEY_GLYPHS, Shortcut, Switch, useColors } from "@dashi/ui";
import { Image, Svg, Text, View } from "@mirinjs/metal";
import type { Row, RowIcon } from "./rows.ts";

export const ROW_HEIGHT = 40;
export const HEAD_HEIGHT = 22;
const ICON = 28;
const BAR = { width: 3, height: 20 };

/** An agent's dot on its row's icon (Now), 6 across. */
const DOT = 6;
/** The stop square at a running agent's right end, as the menu bar's pill draws it. */
const STOP = 9;

function Icon({ icon, agent }: { icon: RowIcon; agent?: Row["agent"] }) {
  const colors = useColors();
  if ("none" in icon) return null;
  if ("image" in icon) return <Image source={icon.image} style={{ width: ICON, height: ICON }} />;
  // A pane's own glyph in ink on a neutral tile: never tinted (CO-2, CO-4). Only Ask's glyph is shiso (CO-3).
  return (
    <View style={{ width: ICON, height: ICON, borderRadius: 6.7, alignItems: "center", justifyContent: "center", backgroundColor: colors.button }}>
      <Svg markup={icon.glyph} size={16} color={agent === "ask" ? colors.agent : colors.text} />
      {agent === "dot" && (
        <View
          testID="launcher:agent-dot"
          style={{ position: "absolute", right: -1, bottom: -1, width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: colors.agent }}
        />
      )}
    </View>
  );
}

function StopSquare({ id, onStop }: { id: string; onStop: () => void }) {
  const colors = useColors();
  return (
    <View testID={`launcher:stop:${id}`} onPress={onStop} style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}>
      <View style={{ width: STOP, height: STOP, borderRadius: 2, backgroundColor: colors.agentInk }} />
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
  /** The stop square of a row that has one (`row.stop`). */
  onStop?: () => void;
}

/** What the right end shows (see the module comment). */
function RightEnd({ row, digit, quiet }: { row: Row; digit: number | undefined; quiet: string }) {
  if (digit !== undefined) return <Shortcut keys={`❖${digit}`} color={quiet} size={11} />;
  if (row.control?.kind === "switch") return <Switch testID={`launcher:switch:${row.id}`} on={row.control.on} />;
  if (row.control?.kind === "value") return <Text style={{ fontSize: 12, color: quiet }}>{row.control.text}</Text>;
  if (row.shortcut) return <Shortcut keys={row.shortcut} color={quiet} size={11} />;
  if (row.kind !== "") return <Text style={{ fontSize: 11, color: quiet }}>{row.kind}</Text>;
  return null;
}

export function ResultRow({ row, selected, onPress, onHover, onContextMenu, digit, onStop }: ResultRowProps) {
  const colors = useColors();
  // On the wash every word is ink: muted ink there would fall under 4.5:1. A destructive row stays red, selected or not.
  // Ask's words are shiso until it is selected: then they are the selection's ink, like any row's.
  const ink = row.danger ? colors.criticalInk : selected ? colors.onSelection : row.agent === "ask" ? colors.agentInk : colors.text;
  const quiet = selected ? colors.onSelection : colors.textMuted;
  return (
    <View
      testID={`launcher:row:${row.id}`}
      onPress={onPress}
      onHoverChange={(hovered) => {
        if (hovered) onHover();
      }}
      {...(onContextMenu ? { onContextMenu } : {})}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        height: ROW_HEIGHT,
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
            top: (ROW_HEIGHT - BAR.height) / 2,
            width: BAR.width,
            height: BAR.height,
            borderRadius: 1.5,
            backgroundColor: colors.selectionBar,
          }}
        />
      )}
      <Icon icon={row.icon} {...(row.agent ? { agent: row.agent } : {})} />
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flexShrink: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, color: ink, ...(row.strong ? { fontWeight: "semibold" } : {}) }}>
            {row.title}
          </Text>
        </View>
        {row.chord !== undefined && <Shortcut keys={row.chord} color={ink} size={12} />}
        {row.badge !== undefined && (
          <View
            testID={`launcher:badge:${row.id}`}
            style={{ flexShrink: 0, paddingLeft: 5, paddingRight: 5, height: 16, borderRadius: 4, justifyContent: "center", backgroundColor: colors.button }}
          >
            <Text style={{ fontSize: 11, color: ink }}>{row.badge}</Text>
          </View>
        )}
        {row.detail !== undefined && (
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 12, color: quiet }}>
              {row.detail}
            </Text>
          </View>
        )}
      </View>
      <RightEnd row={row} digit={digit} quiet={quiet} />
      {row.stop && onStop && <StopSquare id={row.id} onStop={onStop} />}
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
