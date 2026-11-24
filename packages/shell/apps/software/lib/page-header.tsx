/**
 * The head of an item's page, one for apps, packages and applets alike
 * (AB-41): its icon, its name as the page's title (TY-1's 20 Bold), a byline
 * in 12 muted (who made it, a version, where it comes from) with a trust mark
 * after it, the summary in 13, any further lines, and the buttons that fit at
 * the right. The page's sections follow it.
 */

import { SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";

/** An item's icon on its page; the head's gap beside it. */
export const PAGE_ICON = 80;
const ICON_GAP = SPACE.page;

/** The page's own measures: its padding and the gap between its sections. */
export const ITEM_PAGE = { padding: SPACE.xl, gap: SPACE.sheet } as const;

export function PageHeader({
  icon,
  title,
  byline,
  mark,
  summary,
  children,
  actions,
}: {
  icon: ReactNode;
  title: string;
  byline: string;
  /** Flathub's verified check, after the byline. */
  mark?: ReactNode;
  summary?: string;
  /** Lines under the summary: where it is installed, that it was pulled. */
  children?: ReactNode;
  /** The buttons and the source, at the right. */
  actions?: ReactNode;
}) {
  const colors = useColors();
  return (
    <View testID="page-header" style={{ flexShrink: 0, flexDirection: "row", alignItems: "flex-start", gap: ICON_GAP }}>
      {icon}
      <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: SPACE.xs }}>
        <Text style={{ fontSize: TYPE.title.size, lineHeight: TYPE.title.line, fontWeight: WEIGHT.bold, color: colors.text }}>{title}</Text>
        {(byline !== "" || mark !== undefined) && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s }}>
            {byline !== "" && (
              <View testID="page-header:byline" style={{ flexShrink: 1, minWidth: 0 }}>
                <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>{byline}</Text>
              </View>
            )}
            {mark}
          </View>
        )}
        {summary !== undefined && <Text style={{ fontSize: TYPE.body.size, lineHeight: TYPE.body.line, color: colors.text }}>{summary}</Text>}
        {children}
      </View>
      {actions !== undefined && <View style={{ flexShrink: 0, flexDirection: "column", alignItems: "flex-end", gap: SPACE.m }}>{actions}</View>}
    </View>
  );
}

/** A further line under the summary: 12, muted, or ume for a warning ("no longer maintained"). */
export function HeaderLine({ children, warning }: { children: string; warning?: boolean }) {
  const colors = useColors();
  return <Text style={{ fontSize: TYPE.secondary.size, color: warning ? colors.ume : colors.textMuted }}>{children}</Text>;
}
