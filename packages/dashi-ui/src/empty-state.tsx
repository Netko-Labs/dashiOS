/**
 * What a list or a pane shows when it has nothing (PA-7, PA-17). A pane's
 * is a 36 glyph of what lives there, a 15 SemiBold title in sentence case
 * ("No notes yet"), a 12 message on how to add, and the one action where the
 * person can add here. A search that found nothing is `NoResults`: the
 * search glyph, "No results" over “Nothing matches ‹query›.”, and at most
 * one sentence that helps. A panel's (the notification centre, the agents'
 * panel) is one line, 12 muted (`variant="panel"`). Only one shows at a time.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { SEARCH } from "./glyphs.ts";
import { SPACE, TYPE, useColors, WEIGHT } from "./theme/index.ts";

/** Its measures: the glyph, the room around it, the gaps. */
export const EMPTY_STATE = { glyph: 36, padding: SPACE.xl, gap: SPACE.s, panelPadding: SPACE.page } as const;

export function EmptyState({
  title,
  message,
  glyph,
  action,
  variant = "pane",
  testID = "empty",
}: {
  title: string;
  message?: string;
  glyph?: string;
  action?: ReactNode;
  /** "panel": one line, 12 muted, the title alone (a panel's "No notifications"). */
  variant?: "pane" | "panel";
  testID?: string;
}) {
  const colors = useColors();
  if (variant === "panel") {
    return (
      <View testID={testID} style={{ padding: EMPTY_STATE.panelPadding, alignItems: "center" }}>
        <Text style={{ fontSize: TYPE.secondary.size, lineHeight: TYPE.secondary.line, color: colors.textMuted, textAlign: "center" }}>{title}</Text>
      </View>
    );
  }
  return (
    <View
      testID={testID}
      style={{ flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: EMPTY_STATE.gap, padding: EMPTY_STATE.padding }}
    >
      {glyph !== undefined && <Svg markup={glyph} size={EMPTY_STATE.glyph} color={colors.textDisabled} />}
      <Text style={{ fontSize: TYPE.heading.size, lineHeight: TYPE.heading.line, fontWeight: WEIGHT.semibold, color: colors.textMuted, textAlign: "center" }}>
        {title}
      </Text>
      {message !== undefined && (
        <Text style={{ fontSize: TYPE.secondary.size, lineHeight: TYPE.secondary.line, color: colors.textMuted, textAlign: "center" }}>{message}</Text>
      )}
      {action !== undefined && <View style={{ marginTop: SPACE.m }}>{action}</View>}
    </View>
  );
}

/** The words a search that found nothing says about `query` (PA-17). */
export const noResultsMessage = (query: string): string => `Nothing matches “${query.trim()}”.`;

/** A search that found nothing (PA-17): "No results", what didn't match, and at most one sentence that helps. */
export function NoResults({ query, hint, testID = "no-results" }: { query: string; hint?: string; testID?: string }) {
  return <EmptyState testID={testID} glyph={SEARCH} title="No results" message={hint ? `${noResultsMessage(query)} ${hint}` : noResultsMessage(query)} />;
}
