/**
 * The pieces the shell's small sheets are made of: a centered panel with room around it for
 * its shadow, and its buttons. The menus' own sheets (lib/power-sheets.tsx) and other
 * modules' (Wi-Fi, Bluetooth, accounts, polkit) use them.
 */

import { Button as KitButton, RADIUS, SHADOW, SPACE, useColors } from "@dashi/ui";
import { View } from "@mirinjs/metal";
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
          gap: SPACE.gap,
          padding: SPACE.sheet,
          // A sheet is 12 (RA-2).
          borderRadius: RADIUS.sheet,
          backgroundColor: colors.menu,
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: SHADOW.xl,
        }}
      >
        {children}
      </View>
    </View>
  );
}

/** A sheet's button: the kit's Button, taking its share of the row (UI-8). */
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
  return <KitButton testID={testID} label={label} fill {...(primary ? { primary } : {})} {...(disabled ? { disabled } : {})} onPress={onPress} />;
}
