/**
 * What a pane or page shows when it couldn't load (PA-6): its glyph 28 in
 * its job colour (ume, or broth when it is offline and may come back), one
 * 13 SemiBold sentence naming the thing, a 12 muted message on what to do,
 * and its one or two ways on as buttons under the words. Never an empty
 * state, never errno text. Something that failed while the person did
 * something else is a Notice instead; a field's problem is TextField's line.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { OFFLINE, PROBLEM } from "./glyphs.ts";
import { SPACE, TYPE, useColors, WEIGHT } from "./theme/index.ts";

/** Its measures: the glyph, the room around it, the gaps. */
export const ERROR_STATE = { glyph: 28, padding: SPACE.xl, gap: SPACE.s, actionsGap: SPACE.m, words: 360 } as const;

export function ErrorState({
  title,
  message,
  kind = "failed",
  glyph,
  actions,
  testID = "error",
}: {
  /** One sentence naming the thing: "Couldn’t open “Report.pdf”." */
  title: string;
  /** What to do next, in a plain sentence. */
  message?: string;
  /** "offline": it may come back by itself (broth, a cloud); "failed" (ume). */
  kind?: "failed" | "offline";
  /** A glyph of its own in place of the kind's. */
  glyph?: string;
  /** Its one or two ways on: Buttons. */
  actions?: ReactNode;
  testID?: string;
}) {
  const colors = useColors();
  const offline = kind === "offline";
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={{ flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: ERROR_STATE.gap, padding: ERROR_STATE.padding }}
    >
      <Svg markup={glyph ?? (offline ? OFFLINE : PROBLEM)} size={ERROR_STATE.glyph} color={offline ? colors.broth : colors.ume} />
      <View style={{ maxWidth: ERROR_STATE.words, flexDirection: "column", alignItems: "center", gap: SPACE.xxs }}>
        <Text style={{ fontSize: TYPE.body.size, lineHeight: TYPE.body.line, fontWeight: WEIGHT.semibold, color: colors.text, textAlign: "center" }}>
          {title}
        </Text>
        {message !== undefined && (
          <Text style={{ fontSize: TYPE.secondary.size, lineHeight: TYPE.secondary.line, color: colors.textMuted, textAlign: "center" }}>{message}</Text>
        )}
      </View>
      {actions !== undefined && <View style={{ flexDirection: "row", gap: ERROR_STATE.actionsGap, marginTop: SPACE.s }}>{actions}</View>}
    </View>
  );
}
