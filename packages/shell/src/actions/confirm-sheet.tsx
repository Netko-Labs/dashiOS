/**
 * The person's own sheet for an action that asks every time (force quitting
 * an app, moving a file to the Trash), and for what a link asked for. It is
 * the agents' confirm sheet without an agent: the alert frame (UI-5) with a
 * neutral tile, no "wants to", just the question in the person's words. It
 * goes in the agents' sheet queue (agent-sheets/agent-sheets.tsx), so only
 * the person's own press answers yes: the sheet never takes the keyboard.
 */

import { AlertSheet, INFO, WARNING } from "@dashi/ui";
import type { ReactElement } from "react";

export interface PersonQuestion {
  /** The question, a sentence ending in "?": "Force “Notes” to quit?" */
  title: string;
  detail: string;
  /** The button that goes ahead ("Force Quit", "Move to Trash", "Run"). */
  action: string;
  /** Losing work or a thing that can't be taken back: the button is ume. */
  danger?: boolean;
}

/** The sheet's card on its surface. */
const WIDTH = 400;

/** An agent tool's question ("force “Notes” to quit") as the person's: "Force “Notes” to quit?" */
export function personTitle(summary: string): string {
  const text = summary.trim().replace(/[.?]$/, "");
  return text === "" ? "Go ahead?" : `${text.charAt(0).toUpperCase()}${text.slice(1)}?`;
}

export function PersonConfirmSheet({ question, onAnswer }: { question: PersonQuestion; onAnswer: (yes: boolean) => void }): ReactElement {
  const danger = question.danger !== false;
  return (
    <AlertSheet
      testID="person-confirm"
      place="screen"
      keys={false}
      width={WIDTH}
      question={question.title}
      message={question.detail}
      glyph={danger ? WARNING : INFO}
      tone={danger ? "danger" : "neutral"}
      buttons={[
        { label: "Cancel", testID: "person-cancel", onPress: () => onAnswer(false), cancel: true, isDefault: danger },
        { label: question.action, testID: "person-go", onPress: () => onAnswer(true), kind: danger ? "danger" : "primary", isDefault: false },
      ]}
    />
  );
}
