/** Settings › Voice's pieces of a fetch (voice.tsx): its progress, and "Remove…" that confirms in place. */

import { PROGRESS_BAR, ProgressBar, SPACE, TYPE } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { sizeWords } from "../../../voice/index.ts";
import { useColors } from "../../colors.ts";
import { ConfirmDelete } from "./parts.tsx";

/** A fetch's progress: the kit's bar, in ink (Q3), and "412 MB of 1.01 GB". */
export function Fetching({ received, bytes, testID }: { received: number; bytes: number; testID: string }) {
  const colors = useColors();
  const part = bytes > 0 ? Math.min(1, received / bytes) : null;
  return (
    <View testID={testID} style={{ alignSelf: "stretch", flexDirection: "column", gap: SPACE.xs }}>
      <View style={{ alignSelf: "stretch", height: PROGRESS_BAR.regular, flexDirection: "row" }}>
        <ProgressBar testID={`${testID}:bar`} value={part} size="regular" label="Fetching" />
      </View>
      <Text style={{ fontSize: TYPE.panel.detail.size, color: colors.textMuted }}>
        {bytes > 0 ? `${sizeWords(received)} of ${sizeWords(bytes)}` : "Starting…"}
      </Text>
    </View>
  );
}

/** "Remove…", confirmed in place (SE-12). */
export function Remove({ testID, onRemove }: { testID: string; onRemove: () => void }) {
  return <ConfirmDelete testID={testID} verb="Remove" onDelete={onRemove} />;
}
