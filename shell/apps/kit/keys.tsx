/**
 * The invisible, focused input that gives a window its keys (keys.ts says
 * how). Put one in a window that has nothing else to type into; a window
 * with a text field gets its keys from that field instead.
 */

import { TextInput, View } from "@mirinjs/metal";
import { useReducer, useRef } from "react";
import { KeyBuffer, type KeyInput } from "./keys.ts";

export interface KeySinkProps {
  onKey: (key: KeyInput) => void;
  /**
   * Change it to take the keyboard back (the sink is mounted again, and a new
   * input asks for focus): after a sheet that had its own keys closes, say.
   */
  focusKey?: string | number;
  testID?: string;
}

export function KeySink({ onKey, focusKey = 0, testID = "keys" }: KeySinkProps) {
  const buffer = useRef<KeyBuffer | null>(null);
  buffer.current ??= new KeyBuffer();
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const deliver = (keys: KeyInput[]): void => {
    for (const key of keys) onKey(key);
  };
  return (
    <View style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, opacity: 0, overflow: "hidden" }}>
      <TextInput
        key={String(focusKey)}
        testID={testID}
        value={buffer.current.value}
        autoFocus
        onChangeText={(text) => {
          const keys = buffer.current?.change(text) ?? [];
          rerender();
          deliver(keys);
        }}
        onSubmitEditing={() => deliver([{ kind: "enter" }])}
        onKeyPress={(key) => deliver([{ kind: key === "Escape" ? "escape" : key === "ArrowUp" ? "up" : "down" }])}
        style={{ width: 1, height: 1, color: "#00000000", backgroundColor: "#00000000" }}
      />
    </View>
  );
}
