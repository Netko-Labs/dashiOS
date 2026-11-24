/**
 * A section's heading on a page (TY-1: 13 bold, a 12 muted line under it),
 * with its action at the right ("See all", a TextLink in ink; "Update all").
 * It is inset as the rows under it are (`ROW.inset`), so its words start
 * where theirs do and its button ends where theirs do; the button is
 * centred on the words.
 */

import { SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
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
        gap: SPACE.inset,
        marginTop: SPACE.s,
        paddingHorizontal: ROW.inset,
      }}
    >
      <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: SPACE.px }}>
        <Text style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.bold, color: colors.text }}>{title}</Text>
        {detail !== undefined && <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>{detail}</Text>}
      </View>
      {action}
    </View>
  );
}
