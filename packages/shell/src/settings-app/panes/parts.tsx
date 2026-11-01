/**
 * Small pieces the machine panes (Network, Bluetooth, Sound, Battery & Power,
 * Users & Accounts) share beyond ui.tsx's: a value at the end of a row, a
 * compact button, a pressable list row, and a round icon.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { CHECK, useColors } from "@dashi/ui";

/** A value at the end of a row, muted and right-aligned (several lines stack). */
export function Value({ children, testID }: { children: string | readonly string[]; testID?: string }) {
  const colors = useColors();
  const lines = typeof children === "string" ? [children] : children;
  return (
    <View testID={testID} style={{ flexShrink: 1, flexDirection: "column", alignItems: "flex-end", minWidth: 0 }}>
      {lines.map((line, index) => (
        // Lines of a value never reorder.
        <Text key={index} numberOfLines={1} style={{ fontSize: 13, color: colors.textMuted, textAlign: "right" }}>
          {line}
        </Text>
      ))}
    </View>
  );
}

/** A compact button for a row: Join, Forget, Connect. */
export function MiniButton({ label, onPress, testID, tone, disabled }: { label: string; onPress: () => void; testID: string; tone?: "critical" | "primary"; disabled?: boolean }) {
  const colors = useColors();
  const ink = disabled ? colors.textDisabled : tone === "critical" ? colors.critical : tone === "primary" ? "#ffffff" : colors.text;
  return (
    <View
      testID={testID}
      onPress={disabled ? undefined : onPress}
      style={{
        height: 24,
        paddingHorizontal: 11,
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tone === "primary" && !disabled ? colors.selection : colors.button,
        hoverBackgroundColor: disabled ? colors.button : tone === "primary" ? colors.selection : colors.separator,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: tone === "primary" ? "semibold" : "normal", color: ink }}>{label}</Text>
    </View>
  );
}

/** A row of a list: a leading mark or icon, a name and a quieter line, then what goes at the end. Pressing it is optional. */
export function ListRow({
  testID,
  name,
  detail,
  leading,
  children,
  onPress,
  bold,
}: {
  testID?: string;
  name: string;
  detail?: string | undefined;
  leading?: ReactNode;
  children?: ReactNode;
  onPress?: (() => void) | undefined;
  bold?: boolean;
}) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingHorizontal: 12, paddingVertical: 6, hoverBackgroundColor: onPress ? colors.button : "#00000000" }}
    >
      {leading}
      <View style={{ flex: 1, flexDirection: "column", gap: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: bold ? "semibold" : "normal", color: colors.text }}>
          {name}
        </Text>
        {detail !== undefined && (
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
            {detail}
          </Text>
        )}
      </View>
      {children}
    </View>
  );
}

/** A check in a fixed-width slot, so names line up whether or not they are chosen. */
export function CheckSlot({ on }: { on: boolean }) {
  const colors = useColors();
  return <View style={{ width: 16, alignItems: "center" }}>{on && <Svg markup={CHECK} size={13} color={colors.selection} />}</View>;
}

/** A round icon: lit with the accent while `lit`. */
export function RoundIcon({ glyph, lit, size = 28 }: { glyph: string; lit: boolean; size?: number }) {
  const colors = useColors();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center", backgroundColor: lit ? colors.selection : colors.track }}>
      <Svg markup={glyph} size={Math.round(size * 0.52)} color={lit ? "#ffffff" : colors.text} />
    </View>
  );
}

/** A sentence for a failure, in the critical color, under a group. */
export function Failure({ children, testID }: { children: string; testID: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flexShrink: 0, paddingHorizontal: 4 }}>
      <Text style={{ fontSize: 12, color: colors.critical }}>{children}</Text>
    </View>
  );
}
