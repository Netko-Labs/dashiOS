/**
 * What a page shows when it can't load (an error state, PA-6), and the two
 * status chips in the toolbar that say what state the window is in without a
 * second bar (VS-5): saved results shown while Flathub can't be reached, and
 * the queue's activity ("Installing VLC 42% · 2 waiting"). A page that is
 * loading shows @dashi/ui's `Loading`.
 */

import { Button, Chip, ErrorState } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { OFFLINE } from "./glyphs.ts";
import type { Load } from "./hooks.ts";

export function Failed({ state, onRetry }: { state: Extract<Load<unknown>, { status: "failed" }>; onRetry: () => void }) {
  return (
    <ErrorState
      testID="failed"
      kind={state.offline ? "offline" : "failed"}
      title={state.offline ? "You’re offline" : "Flathub isn’t responding"}
      message={
        state.offline
          ? "The Store needs the internet to look for apps. Your installed apps and updates are in the sidebar."
          : "Try again in a minute. Your installed apps and updates are in the sidebar."
      }
      actions={<Button label="Try again" testID="retry" onPress={onRetry} />}
    />
  );
}

/**
 * The queue's activity in the toolbar row: the kit's toolbar chip, which a
 * click opens (what runs: its page, or Updates). It keeps its width while the
 * search field gives way; past `maxWidth` its words end in an ellipsis.
 */
export function Activity({ text, testID, onPress, maxWidth }: { text: string; testID: string; onPress: () => void; maxWidth: number }) {
  return (
    <View testID={testID} focusable accessibilityRole="button" accessibilityLabel={text} onPress={onPress} style={{ flexShrink: 0, maxWidth }}>
      <Chip label={text} size="toolbar" />
    </View>
  );
}

/** "Offline · showing saved results" ("Offline" when `short`): while a page shows answers Flathub gave earlier. */
export function StaleNote({ short = false }: { short?: boolean }) {
  return <Chip testID="stale" glyph={OFFLINE} size="toolbar" tone="warning" label={short ? "Offline" : "Offline · showing saved results"} />;
}
