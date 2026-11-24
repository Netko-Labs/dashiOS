/**
 * The list the time zone and language pickers share: the kit's pick rows
 * (UI-13) in a scrolling well, one Tab stop where ↑ and ↓ choose, and a line
 * for nothing found or more than are shown. Their search is the kit's
 * SearchField (UI-11), the width of the column.
 */

import { PickList as KitPickList, RADIUS, SPACE, TYPE } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { useColors } from "../../settings-app/colors.ts";
import { useSurface } from "../../shared/cards/index.ts";

export function PickList({ children, testID, height }: { children: ReactNode; testID: string; height: number }) {
  const surface = useSurface();
  return (
    <ScrollView style={{ flex: 1, height, flexDirection: "column", padding: SPACE.xs, borderRadius: RADIUS.control, backgroundColor: surface.field }}>
      <KitPickList testID={testID}>{children}</KitPickList>
    </ScrollView>
  );
}

/** A line inside a list: nothing found, or more than are shown. */
export function PickNote({ children, testID }: { children: string; testID?: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flexShrink: 0, padding: SPACE.gap, alignItems: "center" }}>
      <Text style={{ fontSize: TYPE.caption.size, color: colors.textMuted, textAlign: "center" }}>{children}</Text>
    </View>
  );
}
