/**
 * The pieces the shell's small sheets are made of: a centered panel with room around it for
 * its shadow, and its buttons. The menus' own sheets (lib/power-sheets.tsx) and other
 * modules' (Wi-Fi, Bluetooth, accounts, polkit) use them.
 */

import { buttonLook, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";

/** Panel size, and the margin the shadow needs on each side. */
export const SHEET_SIZE = { width: 340, margin: 28 } as const;

export function Panel({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View
        occlude
        style={{
          width: SHEET_SIZE.width,
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          padding: 22,
          borderRadius: 16,
          backgroundColor: colors.menu,
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: "xl",
        }}
      >
        {children}
      </View>
    </View>
  );
}

export function Button({
  label,
  primary,
  disabled,
  testID,
  onPress,
}: {
  label: string;
  primary?: boolean;
  /** Dimmed and deaf to presses. */
  disabled?: boolean;
  testID: string;
  onPress: () => void;
}) {
  const colors = useColors();
  const look = buttonLook(colors, "primary");
  return (
    <View
      testID={testID}
      onPress={disabled ? undefined : onPress}
      style={{
        flex: 1,
        height: 28,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 7,
        backgroundColor: primary ? look.fill : colors.button,
        hoverBackgroundColor: primary && !disabled ? look.hover : primary ? look.fill : colors.button,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: primary ? "semibold" : "normal", color: primary ? look.ink : colors.text }}>{label}</Text>
    </View>
  );
}
