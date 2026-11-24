/**
 * `--text-info`: a file's text (`--filename`) or stdin's as it arrives, in a
 * scrolling pane. `--editable` makes it a field, and OK prints what it holds;
 * `--checkbox` adds a box to tick before OK is enabled (a license to accept).
 */

import { Checkbox, RADIUS, SPACE, TextArea, TYPE, useColors, useSurface } from "@dashi/ui";
import { ScrollView, Text } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { type Answer, DialogFrame, standardButtons } from "./frame.tsx";
import type { TextInfoSpec } from "./spec.ts";
import { readStdinText } from "./stdin.ts";

/** The text to show: the file's, or stdin's as it grows. */
function useSource(filename: string | null): string {
  const [text, setText] = useState("");
  useEffect(() => {
    if (filename !== null) {
      Bun.file(filename)
        .text()
        .then(setText, (error: unknown) => {
          console.error(`dashi-dialog: can't read ${filename}: ${error instanceof Error ? error.message : String(error)}`);
        });
      return;
    }
    return readStdinText(
      (piece) => setText((now) => now + piece),
      () => {},
    );
  }, [filename]);
  return text;
}

export function TextInfoView({ spec, answer }: { spec: TextInfoSpec; answer: Answer }) {
  const colors = useColors();
  const surface = useSurface();
  const source = useSource(spec.filename);
  // An edit takes over from the source; until then the field follows it.
  const [edited, setEdited] = useState<string | null>(null);
  const text = edited ?? source;
  const [accepted, setAccepted] = useState(false);
  const ok = (): void => answer(0, spec.editable ? (text.endsWith("\n") ? text : `${text}\n`) : undefined);
  const buttons = standardButtons({
    okLabel: spec.okLabel,
    cancelLabel: spec.cancelLabel,
    extraButtons: spec.extraButtons,
    answer,
    onOk: ok,
    okDisabled: spec.checkbox !== null && !accepted,
  });
  const pane = { flex: 1, minHeight: 0, borderRadius: RADIUS.control, borderWidth: 1, borderColor: colors.separator, backgroundColor: surface.card };
  return (
    <DialogFrame title={spec.title} buttons={buttons} onCancel={() => answer(1)} keys={!spec.editable}>
      {spec.editable ? (
        <TextArea
          testID="dialog:text-info"
          value={text}
          label={spec.title}
          small
          autoFocus
          onChangeText={setEdited}
          onKeyPress={(key) => key === "Escape" && answer(1)}
        />
      ) : (
        <ScrollView testID="dialog:text-info" style={{ ...pane, flexDirection: "column", padding: SPACE.m }}>
          {text.split("\n").map((line, index) => (
            <Text key={index} style={{ fontSize: TYPE.secondary.size, color: colors.text, lineHeight: TYPE.secondary.line }}>
              {line === "" ? " " : line}
            </Text>
          ))}
        </ScrollView>
      )}
      {spec.checkbox !== null && <Checkbox testID="dialog:checkbox" label={spec.checkbox} checked={accepted} onChange={setAccepted} />}
    </DialogFrame>
  );
}
