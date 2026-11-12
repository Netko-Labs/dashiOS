/**
 * A section's heading on a page (TY-1: 13 bold, a 12 muted line under it),
 * with its action at the right ("See all", "Update all"). It is inset as
 * the rows under it are (`ROW.inset`), so its words start where theirs do
 * and its button ends where theirs do; the button is centred on the words.
 */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { ROW } from "./parts.tsx";

export function SectionHeader({ title, detail, action, testID }: { title: string; detail?: string; action?: ReactNode; testID?: string }) {
  const colors = useColors();
  return (
    <View
      {...(testID ? { testID } : {})}
      style={{
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginTop: 6,
        paddingHorizontal: ROW.inset,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>{title}</Text>
        {detail !== undefined && <Text style={{ fontSize: 12, color: colors.textMuted }}>{detail}</Text>}
      </View>
      {action}
    </View>
  );
}

/** A quiet link-like button in a heading ("See all"). */
export function HeadingLink({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="button"
      onPress={onPress}
      style={{ flexShrink: 0, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 5, hoverBackgroundColor: colors.button }}
    >
      <Text style={{ fontSize: 12, color: colors.accentInk }}>{label}</Text>
    </View>
  );
}
