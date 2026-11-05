/**
 * The person's own sheet for an action that asks every time (force quitting
 * an app, moving a file to the Trash), and for what a link asked for. It is
 * the agents' confirm sheet without an agent: no mark, no "wants to", just
 * the question in the person's words. It goes in the agents' sheet queue
 * (agent-sheets.tsx), so only the person's own press answers yes.
 */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { Button, opaque } from "../consent.tsx";

export interface PersonQuestion {
  /** The question, a sentence ending in "?": "Force “Notes” to quit?" */
  title: string;
  detail: string;
  /** The button that goes ahead ("Force Quit", "Move to Trash", "Run"). */
  action: string;
  /** Losing work or a thing that can't be taken back: the button is red. */
  danger?: boolean;
}

/** An agent tool's question ("force “Notes” to quit") as the person's: "Force “Notes” to quit?" */
export function personTitle(summary: string): string {
  const text = summary.trim().replace(/[.?]$/, "");
  return text === "" ? "Go ahead?" : `${text.charAt(0).toUpperCase()}${text.slice(1)}?`;
}

export function PersonConfirmSheet({ question, onAnswer }: { question: PersonQuestion; onAnswer: (yes: boolean) => void }) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View
        occlude
        style={{
          width: 400,
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          padding: 22,
          borderRadius: 12,
          backgroundColor: opaque(colors.launcher),
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: "xl",
        }}
      >
        <Text style={{ fontSize: 15, fontWeight: "bold", color: colors.text, textAlign: "center" }}>{question.title}</Text>
        <View style={{ marginTop: 6 }}>
          <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>{question.detail}</Text>
        </View>
        <View style={{ alignSelf: "stretch", flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <Button label="Cancel" onPress={() => onAnswer(false)} />
          <Button label={question.action} {...(question.danger === false ? { primary: true } : { danger: true })} onPress={() => onAnswer(true)} />
        </View>
      </View>
    </View>
  );
}
