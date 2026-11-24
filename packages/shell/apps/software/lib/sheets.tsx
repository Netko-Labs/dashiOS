/**
 * The questions Software asks before it goes ahead (remove, with the choice
 * to delete what was saved; update the system; restart; get an app that
 * reaches far), and the one thing it has to tell: a change that failed, in
 * plain words, with the tool's own text behind Details.
 */

import { AlertSheet, Checkbox, ConfirmSheet, MoreButton, SPACE, TYPE, useColors, WARNING, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { CatalogEntry, InstalledApp, Offer } from "../../../src/shared/software/index.ts";
import { RESTART, SHIELD } from "./glyphs.ts";
import type { Failure } from "./store.ts";
import { ReachLines } from "./trust.tsx";
import type { TrustFacts } from "./trust-words.ts";

export type Ask =
  | { kind: "remove"; app: InstalledApp }
  | { kind: "remove-applet"; id: string; name: string }
  | { kind: "system"; count: number; restart: boolean }
  | { kind: "restart" }
  | { kind: "logout" }
  | { kind: "get"; id: string; name: string; facts: TrustFacts; reasons: string[] }
  | { kind: "get-package"; entry: CatalogEntry; offer: Offer; message: string }
  | { kind: "remove-package"; entry: CatalogEntry; offer: Offer; source: string };

/** The answer: yes or no, and for a removal whether its data goes too. */
export interface Answer {
  yes: boolean;
  deleteData?: boolean;
}

/** Remove…, for an app or an applet: what goes, what stays, and the choice to delete what it saved. */
function RemoveSheet({ name, system, applet, onAnswer }: { name: string; system: boolean; applet: boolean; onAnswer: (answer: Answer) => void }) {
  const [deleteData, setDeleteData] = useState(false);
  const what = applet ? "what it saved" : "its settings and data";
  const message = deleteData
    ? `${applet ? "It leaves the menu bar, and what it saved is deleted" : "The app is taken off this computer, and its settings, sign-ins and the files it keeps for itself are deleted"}. You can’t undo this.`
    : `${applet ? "It leaves the menu bar and this computer" : "The app is taken off this computer"}. ${applet ? "What it saved stays" : "Its settings and data stay"}, so getting it again picks up where you left off.`;
  return (
    <AlertSheet
      testID="remove-sheet"
      width={420}
      question={`Remove “${name}”?`}
      // A no-break space keeps "password." from ending the message alone on its line.
      message={`${message}${system ? " It is installed for everyone, so you’ll be asked for your\u00a0password." : ""}`}
      glyph={WARNING}
      tone="danger"
      buttons={[
        { label: "Cancel", testID: "remove-sheet:cancel", onPress: () => onAnswer({ yes: false }), cancel: true },
        {
          label: deleteData ? "Remove and delete" : "Remove",
          testID: "remove-sheet:confirm",
          onPress: () => onAnswer({ yes: true, deleteData }),
          kind: "danger",
        },
      ]}
    >
      {/* A yes or no beside the sheet's buttons: a checkbox, not a switch (UI-10's checkbox, R13). */}
      <Checkbox testID="remove-sheet:delete-data" label={`Also delete ${what}`} checked={deleteData} onChange={setDeleteData} />
    </AlertSheet>
  );
}

/** Get…: an app that reaches far shows its trust card's reach as a question first. A grant, so Enter doesn't say yes. */
function GetSheet({ ask, onAnswer }: { ask: Extract<Ask, { kind: "get" }>; onAnswer: (answer: Answer) => void }) {
  const colors = useColors();
  const others = ask.facts.reach.lines.filter((line) => !ask.reasons.includes(line));
  return (
    <AlertSheet
      testID="get-sheet"
      width={440}
      question={`Get “${ask.name}”?`}
      message={`${ask.facts.maker.name} · ${ask.facts.maker.line}. It asks for more than most apps:`}
      glyph={SHIELD}
      tone="warning"
      buttons={[
        { label: "Cancel", testID: "get-sheet:cancel", onPress: () => onAnswer({ yes: false }), cancel: true },
        { label: "Get", testID: "get-sheet:get", onPress: () => onAnswer({ yes: true }), kind: "primary", isDefault: false },
      ]}
    >
      <ReachLines lines={ask.reasons} strong={ask.reasons} />
      {others.length > 0 && (
        <>
          <Text style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: colors.textMuted }}>It can also</Text>
          <ReachLines lines={others} />
        </>
      )}
    </AlertSheet>
  );
}

export function Question({ ask, onAnswer }: { ask: Ask; onAnswer: (answer: Answer) => void }) {
  switch (ask.kind) {
    case "remove":
      return <RemoveSheet name={ask.app.name} system={ask.app.installation === "system"} applet={false} onAnswer={onAnswer} />;
    case "remove-applet":
      return <RemoveSheet name={ask.name} system={false} applet onAnswer={onAnswer} />;
    case "get":
      return <GetSheet ask={ask} onAnswer={onAnswer} />;
    case "get-package":
      return (
        <AlertSheet
          testID="get-package-sheet"
          width={440}
          question={`Get “${ask.entry.name}”?`}
          message={ask.message}
          glyph={SHIELD}
          tone="warning"
          buttons={[
            { label: "Cancel", testID: "get-package-sheet:cancel", onPress: () => onAnswer({ yes: false }), cancel: true },
            // A grant (UI-6): Return doesn't say yes.
            { label: "Get", testID: "get-package-sheet:get", onPress: () => onAnswer({ yes: true }), kind: "primary", isDefault: false },
          ]}
        />
      );
    case "remove-package":
      return (
        <ConfirmSheet
          testID="remove-package-sheet"
          title={`Remove “${ask.entry.name}”?`}
          message={`It is taken off this computer (the ${ask.offer.ref} package from ${ask.source}), with what only it needed. Your files stay.`}
          confirmLabel="Remove"
          danger
          glyph={WARNING}
          onConfirm={() => onAnswer({ yes: true })}
          onCancel={() => onAnswer({ yes: false })}
        />
      );
    case "system":
      return (
        <ConfirmSheet
          testID="system-sheet"
          title="Update the system?"
          message={`${ask.count} ${ask.count === 1 ? "package" : "packages"} will be updated. You’ll be asked for your password.${ask.restart ? " The kernel or core libraries are included, so you’ll need to restart afterwards." : ""}`}
          confirmLabel="Update"
          glyph={RESTART}
          onConfirm={() => onAnswer({ yes: true })}
          onCancel={() => onAnswer({ yes: false })}
        />
      );
    case "logout":
      return (
        <ConfirmSheet
          testID="logout-sheet"
          title="Log out to finish updating Dashi?"
          message="Save your work first: open apps are asked to quit, and their windows aren’t reopened. Dashi starts in its new version when you log back in."
          confirmLabel="Log out"
          glyph={RESTART}
          onConfirm={() => onAnswer({ yes: true })}
          onCancel={() => onAnswer({ yes: false })}
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
          onConfirm={() => onAnswer({ yes: true })}
          onCancel={() => onAnswer({ yes: false })}
        />
      );
  }
}

export function FailureSheet({ failure, onClose }: { failure: Failure; onClose: () => void }) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  // It only informs: one button, which Esc and Enter press too (UI-5). A change that failed is ume (CO-7).
  return (
    <AlertSheet
      testID="failure-sheet"
      width={420}
      question={failure.title}
      message={failure.message}
      glyph={WARNING}
      tone="danger"
      buttons={[{ label: "OK", testID: "failure-sheet:ok", onPress: onClose, kind: "primary" }]}
    >
      {failure.details !== null && (
        <View style={{ flexDirection: "column", gap: SPACE.xs }}>
          <MoreButton testID="failure-sheet:details" open={open} more="Details" less="Hide details" onPress={() => setOpen((now) => !now)} />
          {open && <Text style={{ fontSize: TYPE.caption.size, color: colors.textMuted, lineHeight: TYPE.caption.line }}>{failure.details}</Text>}
        </View>
      )}
    </AlertSheet>
  );
}
