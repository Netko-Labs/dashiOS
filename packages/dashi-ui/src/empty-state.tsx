/** An empty state: what a list or a pane shows when it has nothing. */

import { Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { useColors } from "./theme/index.ts";

/** Nothing to show: a glyph, a line, a quieter line, maybe a way out. */
export function EmptyState({
  title,
  message,
  glyph,
  action,
  testID = "empty",
}: {
  title: string;
  message?: string;
  glyph?: string;
  action?: ReactNode;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: 24 }}>
      {glyph !== undefined && <Svg markup={glyph} size={36} color={colors.textDisabled} />}
      <Text style={{ fontSize: 15, fontWeight: "semibold", color: colors.textMuted, textAlign: "center" }}>{title}</Text>
      {message !== undefined && <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>{message}</Text>}
      {action !== undefined && <View style={{ marginTop: 8 }}>{action}</View>}
    </View>
  );
}
