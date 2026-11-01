/** The questions Software asks before it goes ahead, and the one thing it has to tell: a change that failed. */

import { Text, View } from "@mirinjs/metal";
import type { InstalledApp } from "../../src/software/flatpak-parse.ts";
import { Button, ConfirmSheet, Sheet, useColors } from "../kit/index.ts";
import { RESTART } from "./glyphs.ts";
import type { Failure } from "./store.ts";

export type Ask = { kind: "remove"; app: InstalledApp } | { kind: "system"; count: number; restart: boolean } | { kind: "restart" };

export function Question({ ask, onAnswer }: { ask: Ask; onAnswer: (yes: boolean) => void }) {
  const yes = () => onAnswer(true);
  const no = () => onAnswer(false);
  switch (ask.kind) {
    case "remove":
      return (
        <ConfirmSheet
          testID="remove-sheet"
          title={`Remove “${ask.app.name}”?`}
          message={`The app is taken off this computer. Its settings and data stay, so installing it again picks up where you left off.${ask.app.installation === "system" ? " It is installed for everyone, so you'll be asked for your password." : ""}`}
          confirmLabel="Remove"
          danger
          onConfirm={yes}
          onCancel={no}
        />
      );
    case "system":
      return (
        <ConfirmSheet
          testID="system-sheet"
          title="Update the system?"
          message={`${ask.count} ${ask.count === 1 ? "update" : "updates"} will be installed. You'll be asked for your password.${ask.restart ? " The kernel or core libraries are included, so you'll need to restart afterwards." : ""}`}
          confirmLabel="Update"
          glyph={RESTART}
          onConfirm={yes}
          onCancel={no}
        />
      );
    case "restart":
      return (
        <ConfirmSheet
          testID="restart-sheet"
          title="Restart now?"
          message="Save your work in other apps first. The computer restarts right away to finish the updates."
          confirmLabel="Restart"
          danger
          glyph={RESTART}
          onConfirm={yes}
          onCancel={no}
        />
      );
  }
}

export function FailureSheet({ failure, onClose }: { failure: Failure; onClose: () => void }) {
  const colors = useColors();
  return (
    <Sheet testID="failure-sheet" width={420} onCancel={onClose} onConfirm={onClose}>
      <Text style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>{failure.title}</Text>
      <Text style={{ fontSize: 12, color: colors.textMuted, lineHeight: 16 }}>{failure.message}</Text>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 8 }}>
        <Button label="OK" testID="failure-sheet:ok" primary onPress={onClose} />
      </View>
    </Sheet>
  );
}

