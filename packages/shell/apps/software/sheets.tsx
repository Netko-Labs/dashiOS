/** The questions Software asks before it goes ahead, and the one thing it has to tell: a change that failed. */

import { AlertSheet, ConfirmSheet, WARNING } from "@dashi/ui";
import type { InstalledApp } from "../../src/software/flatpak-parse.ts";
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
  // It only informs: one button, which Esc and Enter press too (UI-5).
  return (
    <AlertSheet
      testID="failure-sheet"
      width={420}
      question={failure.title}
      message={failure.message}
      glyph={WARNING}
      tone="warning"
      buttons={[{ label: "OK", testID: "failure-sheet:ok", onPress: onClose, kind: "primary" }]}
    />
  );
}
