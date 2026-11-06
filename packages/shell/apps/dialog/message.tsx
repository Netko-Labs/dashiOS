/**
 * `--info`, `--warning`, `--error`, and `--question`: a glyph, the message
 * (a short first paragraph in bold), and the buttons. Info, warning, and
 * error have OK; a question has Yes and No (`--switch`: only the extra
 * buttons). OK and Yes exit 0, No and Esc 1.
 */

import { type AlertTone, AlertWindow, glyphs } from "@dashi/ui";
import { type Answer, standardButtons } from "./frame.tsx";
import { splitMessage } from "./markup.ts";
import type { MessageKind, MessageSpec } from "./spec.ts";

const QUESTION =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" stroke="#000" stroke-width="1.4" fill="none"/>' +
  '<path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4" stroke="#000" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
  '<circle cx="8" cy="11.4" r=".9" fill="#000"/></svg>';

function glyphFor(kind: MessageKind): { glyph: string; tone: AlertTone } {
  switch (kind) {
    case "info":
      return { glyph: glyphs.INFO, tone: "accent" };
    case "question":
      return { glyph: QUESTION, tone: "accent" };
    case "warning":
      return { glyph: glyphs.WARNING, tone: "warning" };
    case "error":
      return { glyph: glyphs.STOP, tone: "danger" };
  }
}

/** The one alert frame (UI-5): the first short line is the question, the rest the message under it. */
export function MessageDialog({ spec, answer }: { spec: MessageSpec; answer: Answer }) {
  const { headline, body } = splitMessage(spec.text);
  const question = spec.kind === "question";
  const buttons = standardButtons({
    okLabel: spec.okLabel,
    cancelLabel: spec.cancelLabel,
    extraButtons: spec.extraButtons,
    answer,
    onOk: () => answer(0),
    noCancel: !question || spec.noButtons,
    noOk: question && spec.noButtons,
    defaultCancel: spec.defaultCancel,
  });
  return (
    <AlertWindow
      testID="dialog"
      question={headline}
      message={body}
      {...glyphFor(spec.kind)}
      // Esc is Zenity's Cancel, exit status 1, whatever the buttons are.
      onCancel={() => answer(1)}
      buttons={buttons.map((button) => ({
        label: button.label,
        testID: button.testID,
        onPress: button.onPress,
        disabled: button.disabled,
        ...(button.primary ? { kind: "primary" as const } : {}),
      }))}
    />
  );
}
