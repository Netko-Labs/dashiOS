/**
 * A tile's page, in the tiles' own shapes (docs/design.html, "Control
 * Center"): the tile it was opened from becomes the page's header (back,
 * name, what it is set to, its switch) and grows from where the tile was to
 * the panel's width; the rows under it are 48-point pills that fade in. A
 * chosen row is "on", so it wears the one on, as a tile does. The Wi-Fi, Bluetooth,
 * Sound, power mode, keyboard light and graphics pages are built from these.
 */

import { KnobButton, OPACITY, PANEL_SWITCH, pill, RADIUS, SPACE, Switch, TILE, TYPE, useColors, useControlColors, useGrow, WEIGHT } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { createContext, type ReactNode, useContext } from "react";
import { AppIcon } from "../shared/apps/index.ts";
import { CHEVRON_LEFT as BACK } from "./glyphs.ts";
import { GRID } from "./layout.ts";
import { usePageKey } from "./page-stops.ts";

/** Where the page's tile was in the grid; the header grows from there. Null: it was opened some other way. */
export const PageOrigin = createContext<{ left: number; top: number; width: number } | null>(null);

const INNER = GRID.width - 2 * GRID.padding;

/** A page row: 48 tall, its knob 36 holding a 16 glyph or a 22 app icon. */
export const PAGE_ROW = { height: 48, knob: 36, glyph: 16, icon: 22 } as const;

/**
 * The header's switch: the kit's panel switch, lit on a lit header; the
 * page's keys reach it, so its ring is Metal's, shown by them (KB-2).
 */
function HeaderOnOff({ testID, label, on, lit, onChange }: { testID: string; label: string; on: boolean; lit: boolean; onChange: (on: boolean) => void }) {
  const colors = useControlColors();
  const key = usePageKey(testID, () => onChange(!on));
  return (
    <View
      testID={testID}
      onLayout={key.onLayout}
      focusRingShown={key.focused}
      style={{ borderRadius: pill(PANEL_SWITCH.height), focusRingColor: colors.focus }}
    >
      <Switch testID={`${testID}:control`} look="panel" lit={lit} label={label} on={on} focusable={false} onChange={onChange} />
    </View>
  );
}

export interface PageHeaderProps {
  testID: string;
  title: string;
  detail?: string | null;
  on: boolean;
  onBack: () => void;
  /** The page's switch (Wi-Fi's radio, Bluetooth's power); none without one. */
  toggle?: { on: boolean; onChange: (on: boolean) => void };
}

/** The tile, grown into the page's header. */
export function PageHeader({ testID, title, detail, on, onBack, toggle }: PageHeaderProps) {
  const colors = useControlColors();
  const origin = useContext(PageOrigin);
  const grow = Math.min(useGrow(), 1);
  const from = origin ?? { left: 0, top: 0, width: INNER };
  const ink = on ? colors.onInk : colors.offInk;
  return (
    <View
      testID={testID}
      style={{
        height: GRID.row,
        width: Math.round(from.width + (INNER - from.width) * grow),
        left: Math.round(from.left * (1 - grow)),
        top: Math.round(from.top * (1 - grow)),
        marginBottom: SPACE.gap,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.gap,
        paddingLeft: SPACE.s,
        paddingRight: SPACE.button,
        borderRadius: on ? TILE.radius.on : TILE.radius.off,
        backgroundColor: on ? colors.on : colors.off,
      }}
    >
      <KnobButton testID={`${testID}-back`} glyph={BACK} label="Back" size={TILE.knob} lit={on} onPress={onBack} />
      <View style={{ flex: 1, flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: ink }}>
          {title}
        </Text>
        {detail ? (
          <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: ink, opacity: OPACITY.soft }}>
            {detail}
          </Text>
        ) : null}
      </View>
      {toggle && <HeaderOnOff testID={`${testID}-switch`} label={title} on={toggle.on} lit={on} onChange={toggle.onChange} />}
    </View>
  );
}

/** The rows under the header: they fade in as it grows. */
export function PageBody({ children, testID }: { children: ReactNode; testID?: string }) {
  const grow = Math.min(useGrow(), 1);
  return (
    <View testID={testID} style={{ flexDirection: "column", gap: SPACE.s, opacity: Math.max(grow, 0) }}>
      {children}
    </View>
  );
}

export interface PageRowProps {
  testID: string;
  label: string;
  /** A glyph on the row's knob; a row without one is plain text. */
  glyph?: string;
  /** An app's icon on the knob, in place of a glyph (a file's path). */
  icon?: string;
  /** Words at the right ("Hotspot", "Connected", "Now"). */
  detail?: string | null;
  /** Small glyphs at the right (a lock, the signal). */
  trailing?: ReactNode;
  /** The row chosen (a mode, a level, an output): the one on, as a tile that is on. */
  checked?: boolean;
  onPress?: () => void;
}

export function PageRow({ testID, label, glyph, icon, detail, trailing, checked = false, onPress }: PageRowProps) {
  const colors = useControlColors();
  const ink = checked ? colors.onInk : colors.offInk;
  const key = usePageKey(testID, onPress);
  const radius = checked ? TILE.radius.on : RADIUS.panelCard;
  return (
    <View
      testID={testID}
      onLayout={key.onLayout}
      {...(onPress ? { onPress } : {})}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityState={{ checked }}
      focusRingShown={key.focused}
      style={{
        height: PAGE_ROW.height,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.gap,
        paddingLeft: glyph || icon ? SPACE.s : SPACE.page,
        paddingRight: SPACE.button,
        borderRadius: radius,
        backgroundColor: checked ? colors.on : colors.off,
        position: "relative",
        focusRingColor: colors.focus,
      }}
    >
      {(glyph || icon) && (
        <View
          style={{
            width: PAGE_ROW.knob,
            height: PAGE_ROW.knob,
            borderRadius: pill(PAGE_ROW.knob),
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: checked ? colors.knobOn : colors.knobOff,
          }}
        >
          {icon ? (
            <AppIcon source={icon} style={{ width: PAGE_ROW.icon, height: PAGE_ROW.icon }} />
          ) : (
            <Svg markup={glyph ?? ""} size={PAGE_ROW.glyph} color={ink} />
          )}
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, color: ink }}>
          {label}
        </Text>
      </View>
      {(detail || trailing) && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s, opacity: OPACITY.soft }}>
          {detail && <Text style={{ fontSize: TYPE.caption.size, color: ink }}>{detail}</Text>}
          {trailing}
        </View>
      )}
    </View>
  );
}

/** A section's name over its rows ("More", "Known Networks"). */
export function PageSection({ children, trailing }: { children: string; trailing?: ReactNode }) {
  const colors = useControlColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: SPACE.m, paddingTop: SPACE.xs }}>
      <Text style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: colors.muted }}>{children}</Text>
      {trailing && (
        <>
          <View style={{ flex: 1 }} />
          {trailing}
        </>
      )}
    </View>
  );
}

/** A quiet line in place of rows ("Wi-Fi is off"), or under them (why a mode was chosen). */
export function PageNote({ children, testID, tone = "muted" }: { children: string; testID?: string; tone?: "muted" | "critical" }) {
  const colors = useControlColors();
  const { ume } = useColors();
  return (
    <View testID={testID} style={{ paddingHorizontal: SPACE.m, paddingVertical: SPACE.xs }}>
      <Text style={{ fontSize: TYPE.caption.size, color: tone === "critical" ? ume : colors.muted }}>{children}</Text>
    </View>
  );
}
