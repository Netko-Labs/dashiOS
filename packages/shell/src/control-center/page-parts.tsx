/**
 * A tile's page, in the tiles' own shapes (docs/design.html, "Control
 * Center"): the tile it was opened from becomes the page's header (back,
 * name, what it is set to, its switch) and grows from where the tile was to
 * the panel's width; the rows under it are 48-point pills that fade in. A
 * chosen row is "on", so it is green, as a tile is. The Wi-Fi, Bluetooth,
 * Sound, power mode, keyboard light and graphics pages are built from these.
 */

import { useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { createContext, type ReactNode, useContext } from "react";
import { useGrow } from "../shared/controls/motion.ts";
import { useControlColors } from "../shared/controls/palette.ts";
import { CHEVRON_LEFT as BACK } from "./glyphs.ts";
import { GRID } from "./layout.ts";

/** Where the page's tile was in the grid; the header grows from there. Null: it was opened some other way. */
export const PageOrigin = createContext<{ left: number; top: number; width: number } | null>(null);

const INNER = GRID.width - 2 * GRID.padding;

/** The header's switch: 42 × 24, its knob at the right when on. */
function HeaderSwitch({ testID, on, onChange }: { testID: string; on: boolean; onChange: (on: boolean) => void }) {
  const colors = useControlColors();
  return (
    <View
      testID={testID}
      onPress={() => onChange(!on)}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      style={{
        width: 42,
        height: 24,
        borderRadius: 12,
        padding: 3,
        flexDirection: "row",
        justifyContent: on ? "flex-end" : "flex-start",
        backgroundColor: on ? colors.onInk : colors.line,
      }}
    >
      <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: on ? colors.on : colors.offInk }} />
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
        marginBottom: 10,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingLeft: 6,
        paddingRight: 14,
        borderRadius: on ? 18 : GRID.radius,
        backgroundColor: on ? colors.on : colors.off,
      }}
    >
      <View
        testID={`${testID}-back`}
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: on ? colors.knobOn : colors.knobOff,
        }}
      >
        <Svg markup={BACK} size={18} color={ink} />
      </View>
      <View style={{ flex: 1, flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: ink }}>
          {title}
        </Text>
        {detail ? (
          <Text numberOfLines={1} style={{ fontSize: 11, color: ink, opacity: 0.74 }}>
            {detail}
          </Text>
        ) : null}
      </View>
      {toggle && <HeaderSwitch testID={`${testID}-switch`} on={toggle.on} onChange={toggle.onChange} />}
    </View>
  );
}

/** The rows under the header: they fade in as it grows. */
export function PageBody({ children, testID }: { children: ReactNode; testID?: string }) {
  const grow = Math.min(useGrow(), 1);
  return (
    <View testID={testID} style={{ flexDirection: "column", gap: 6, opacity: Math.max(grow, 0) }}>
      {children}
    </View>
  );
}

export interface PageRowProps {
  testID: string;
  label: string;
  /** A glyph on the row's knob; a row without one is plain text. */
  glyph?: string;
  /** Words at the right ("Hotspot", "Connected", "Now"). */
  detail?: string | null;
  /** Small glyphs at the right (a lock, the signal). */
  trailing?: ReactNode;
  /** The row chosen (a mode, a level, an output): green, as a tile that is on. */
  checked?: boolean;
  onPress?: () => void;
}

export function PageRow({ testID, label, glyph, detail, trailing, checked = false, onPress }: PageRowProps) {
  const colors = useControlColors();
  const ink = checked ? colors.onInk : colors.offInk;
  return (
    <View
      testID={testID}
      {...(onPress ? { onPress } : {})}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityState={{ checked }}
      style={{
        height: 48,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingLeft: glyph ? 6 : 16,
        paddingRight: 14,
        borderRadius: checked ? 18 : 24,
        backgroundColor: checked ? colors.on : colors.off,
      }}
    >
      {glyph && (
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: checked ? colors.knobOn : colors.knobOff,
          }}
        >
          <Svg markup={glyph} size={16} color={ink} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0, overflow: "hidden" }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: ink }}>
          {label}
        </Text>
      </View>
      {(detail || trailing) && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, opacity: 0.7 }}>
          {detail && <Text style={{ fontSize: 11, color: ink }}>{detail}</Text>}
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
    <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 0 }}>
      <Text style={{ fontSize: 11, fontWeight: "semibold", color: colors.muted }}>{children}</Text>
      {trailing && <View style={{ marginLeft: "auto" }}>{trailing}</View>}
    </View>
  );
}

/** A quiet line in place of rows ("Wi-Fi is off"), or under them (why a mode was chosen). */
export function PageNote({ children, testID, tone = "muted" }: { children: string; testID?: string; tone?: "muted" | "critical" }) {
  const colors = useControlColors();
  const { ume } = useColors();
  return (
    <View testID={testID} style={{ paddingLeft: 8, paddingRight: 8, paddingTop: 4, paddingBottom: 4 }}>
      <Text style={{ fontSize: 11, color: tone === "critical" ? ume : colors.muted }}>{children}</Text>
    </View>
  );
}
