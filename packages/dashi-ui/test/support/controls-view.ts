/**
 * Shared set-up for the controls tests: a no-op, and a key the window got, as Metal hands it to a KeySink.
 */

import type { NativeEvent } from "@mirinjs/metal";

export const noop = (): void => {};

/** A key the window got, as Metal hands it to a KeySink (`onWindowKeyDown`). */
export const windowKey = (nodeId: string, key: string): NativeEvent => ({
  type: "windowkey",
  nodeId,
  key,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  repeat: false,
});
