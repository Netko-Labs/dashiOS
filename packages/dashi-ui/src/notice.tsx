/**
 * A notice: a small card floating over the foot of a window's content
 * (`AppWindow`'s `notice`), for something happening now: a job's progress,
 * an error with what to do, "Moved to the Trash" with Undo. It takes no
 * room from the content and goes when it is done, so it is never a second
 * bar (docs/design.html, VS-3). Standing facts (counts, sizes) belong in
 * the sidebar or the content instead.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { CLOSE } from "./glyphs.ts";
import { useColors, useSurface } from "./theme/index.ts";

export interface NoticeProps {
  /** One plain sentence; error text is ume. Leave it out to lay out `children` instead. */
  text?: string;
  tone?: "info" | "error";
  /** A button after the text (Undo, Show). */
  action?: ReactNode;
  /** The x at the end; without it the notice can't be closed by hand. */
  onDismiss?: () => void;
  /** Rows of their own (Files' running jobs), above the text when there is one. */
  children?: ReactNode;
  testID?: string;
}

export function Notice({ text, tone = "info", action, onDismiss, children, testID = "notice" }: NoticeProps) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <View
      testID={testID}
      occlude
      style={{
        maxWidth: 560,
        minWidth: 240,
        flexDirection: "column",
        borderRadius: 10,
        backgroundColor: surface.card,
        borderWidth: 1,
        borderColor: colors.separator,
        shadow: "xl",
        overflow: "hidden",
      }}
    >
      {children}
      {text !== undefined && (
        <View style={{ minHeight: 32, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 14, paddingRight: 8, paddingVertical: 6 }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontSize: 12, color: tone === "error" ? colors.ume : colors.text }}>{text}</Text>
          </View>
          {action}
          {onDismiss !== undefined && (
            <View
              testID={`${testID}:close`}
              onPress={onDismiss}
              style={{ width: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.button }}
            >
              <Svg markup={CLOSE} size={11} color={colors.textMuted} />
            </View>
          )}
        </View>
      )}
    </View>
  );
}
