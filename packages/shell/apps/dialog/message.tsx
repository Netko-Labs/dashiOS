/**
 * `--info`, `--warning`, `--error`, and `--question`: a glyph, the message
 * (a short first paragraph in bold), and the buttons. Info, warning, and
 * error have OK; a question has Yes and No (`--switch`: only the extra
 * buttons). OK and Yes exit 0, No and Esc 1.
 */

import { glyphs, useColors } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import { type Answer, DialogFrame, standardButtons } from "./frame.tsx";
import { splitMessage } from "./markup.ts";
import type { MessageKind, MessageSpec } from "./spec.ts";

const QUESTION =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" stroke="#000" stroke-width="1.4" fill="none"/>' +
  '<path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4" stroke="#000" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
  '<circle cx="8" cy="11.4" r=".9" fill="#000"/></svg>';

function glyphFor(kind: MessageKind, colors: ReturnType<typeof useColors>): { markup: string; tint: string; wash: string } {
  switch (kind) {
    case "info":
      return { markup: glyphs.INFO, tint: colors.selection, wash: `${colors.selection}24` };
    case "question":
      return { markup: QUESTION, tint: colors.selection, wash: `${colors.selection}24` };
    case "warning":
      return { markup: glyphs.WARNING, tint: colors.textMuted, wash: colors.button };
    case "error":
      return { markup: glyphs.STOP, tint: colors.critical, wash: `${colors.critical}24` };
  }
}

/** Lines that keep to one line each (`--no-wrap`), or text that wraps. */
function Lines({ text, bold, noWrap }: { text: string; bold: boolean; noWrap: boolean }) {
  const colors = useColors();
  const style = { fontSize: 13, fontWeight: bold ? ("bold" as const) : ("normal" as const), color: colors.text, lineHeight: 17 };
  if (!noWrap) return <Text style={style}>{text}</Text>;
  return (
    <View style={{ flexDirection: "column", flexShrink: 0 }}>
      {text.split("\n").map((line, index) => (
        <Text key={index} numberOfLines={1} style={style}>
          {line === "" ? " " : line}
        </Text>
      ))}
    </View>
  );
}

export function MessageDialog({ spec, answer }: { spec: MessageSpec; answer: Answer }) {
  const colors = useColors();
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
    <DialogFrame title={spec.title} glyph={glyphFor(spec.kind, colors)} buttons={buttons} onCancel={() => answer(1)}>
      <ScrollView testID="dialog:text" style={{ flex: 1, flexDirection: "column", gap: 4, paddingTop: 2 }}>
        {headline !== "" && <Lines text={headline} bold noWrap={spec.noWrap} />}
        {body !== "" && <Lines text={body} bold={false} noWrap={spec.noWrap} />}
      </ScrollView>
    </DialogFrame>
  );
}
