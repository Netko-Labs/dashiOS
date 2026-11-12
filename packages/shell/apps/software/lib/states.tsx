/**
 * What a page shows when it can't load, and the two chips in the toolbar
 * that say what state the window is in without a second bar (VS-5): saved
 * results shown while Flathub can't be reached, and the queue's activity
 * ("Installing VLC 42% · 2 waiting"). A page that is loading shows
 * @dashi/ui's `Loading`.
 */

import { Button, EmptyState, glyphs, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { OFFLINE } from "./glyphs.ts";
import type { Load } from "./hooks.ts";

export function Failed({ state, onRetry }: { state: Extract<Load<unknown>, { status: "failed" }>; onRetry: () => void }) {
  return (
    <EmptyState
      testID="failed"
      glyph={state.offline ? OFFLINE : glyphs.WARNING}
      title={state.offline ? "You’re offline" : "Flathub isn’t responding"}
      message={
        state.offline
          ? "Software needs the internet to look for apps. Your installed apps and updates are in the sidebar."
          : "Try again in a minute. Your installed apps and updates are in the sidebar."
      }
      action={<Button label="Try again" testID="retry" onPress={onRetry} />}
    />
  );
}

/**
 * A chip in the toolbar row: 24 tall, a pill, muted words, an optional
 * glyph. It keeps its width while the search field gives way; past
 * `maxWidth` its words end in an ellipsis.
 */
export function ToolbarChip({
  text,
  glyph,
  testID,
  onPress,
  maxWidth,
}: {
  text: string;
  glyph?: string;
  testID: string;
  onPress?: () => void;
  maxWidth?: number;
}) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      accessibilityRole={onPress ? "button" : "status"}
      {...(onPress ? { onPress, focusable: true } : {})}
      style={{
        height: 24,
        flexShrink: 0,
        ...(maxWidth === undefined ? {} : { maxWidth }),
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 10,
        borderRadius: 12,
        backgroundColor: colors.button,
        ...(onPress ? { hoverBackgroundColor: colors.separator } : {}),
      }}
    >
      {glyph !== undefined && <Svg markup={glyph} size={12} color={colors.textMuted} />}
      <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
        {text}
      </Text>
    </View>
  );
}

/** "Offline · showing saved results" ("Offline" when `short`): while a page shows answers Flathub gave earlier. */
export function StaleChip({ short = false }: { short?: boolean }) {
  return <ToolbarChip testID="stale" glyph={OFFLINE} text={short ? "Offline" : "Offline · showing saved results"} />;
}
