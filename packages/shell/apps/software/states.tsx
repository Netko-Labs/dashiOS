/** What a page shows when it can't load (offline, Flathub's trouble), and when it served saved results; a page that is loading shows @dashi/ui's `Loading`. */

import { Button, EmptyState, glyphs, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { OFFLINE } from "./glyphs.ts";
import type { Load } from "./hooks.ts";

export function Failed({ state, onRetry }: { state: Extract<Load<unknown>, { status: "failed" }>; onRetry: () => void }) {
  return (
    <EmptyState
      testID="failed"
      glyph={state.offline ? OFFLINE : glyphs.WARNING}
      title={state.offline ? "You're offline" : "Flathub didn't answer"}
      message={state.offline ? "Software needs the internet to look for apps. Your installed apps and updates are in the sidebar." : state.message}
      action={<Button label="Try Again" testID="retry" onPress={onRetry} />}
    />
  );
}

/** A quiet line above a page that was served from saved results. */
export function StaleNote() {
  const colors = useColors();
  return (
    <View
      testID="stale"
      style={{
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        backgroundColor: colors.button,
      }}
    >
      <Text style={{ fontSize: 11, color: colors.textMuted }}>Flathub can't be reached, so these are saved results from earlier.</Text>
    </View>
  );
}
