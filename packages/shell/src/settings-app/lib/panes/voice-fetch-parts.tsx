/** Settings › Voice's pieces of a fetch (voice.tsx): the progress bar, and "Remove…" that asks first. */

import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { sizeWords } from "../../../voice/index.ts";
import { useColors } from "../../colors.ts";
import { MiniButton } from "./parts.tsx";

/** A fetch's progress: a bar, and "412 MB of 1.01 GB". */
export function Progress({ received, bytes, testID }: { received: number; bytes: number; testID: string }) {
  const colors = useColors();
  const part = bytes > 0 ? Math.min(1, received / bytes) : 0;
  return (
    <View testID={testID} accessibilityLabel={`${Math.round(part * 100)}% fetched`} style={{ alignSelf: "stretch", flexDirection: "column", gap: 5 }}>
      <View style={{ alignSelf: "stretch", height: 6, borderRadius: 3, backgroundColor: colors.button, overflow: "hidden" }}>
        <View style={{ width: `${Math.round(part * 100)}%`, height: 6, borderRadius: 3, backgroundColor: colors.text }} />
      </View>
      <Text style={{ fontSize: 11.5, color: colors.textMuted }}>{bytes > 0 ? `${sizeWords(received)} of ${sizeWords(bytes)}` : "Starting…"}</Text>
    </View>
  );
}

/** "Remove…" that asks first, in place. */
export function Remove({ testID, onRemove }: { testID: string; onRemove: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <MiniButton testID={testID} label="Remove…" tone="critical" onPress={() => setAsking(true)} />;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <MiniButton testID={`${testID}:cancel`} label="Cancel" onPress={() => setAsking(false)} />
      <MiniButton
        testID={`${testID}:confirm`}
        label="Remove"
        tone="critical"
        onPress={() => {
          setAsking(false);
          onRemove();
        }}
      />
    </View>
  );
}
