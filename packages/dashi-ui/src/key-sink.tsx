/**
 * Where a window's keys go when nothing takes them (keys.ts says which):
 * a view with no size that hears Metal's window keys. Put one in a window
 * that has nothing else to type into; while a text field has the keyboard
 * the field gets the keys instead.
 */

import { View } from "@mirinjs/metal";
import { type KeyInput, keyInputFor } from "./keys.ts";

export interface KeySinkProps {
  onKey: (key: KeyInput) => void;
  /**
   * Change it to take the keyboard back from a text field (a new sink
   * appearing gives the keyboard to the window): after a sheet that had its
   * own field closes, say.
   */
  focusKey?: string | number;
  testID?: string;
}

export function KeySink({ onKey, focusKey = 0, testID = "keys" }: KeySinkProps) {
  return (
    <View
      key={String(focusKey)}
      testID={testID}
      onWindowKeyDown={(key) => {
        const input = keyInputFor(key);
        if (input) onKey(input);
      }}
      style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }}
    />
  );
}
