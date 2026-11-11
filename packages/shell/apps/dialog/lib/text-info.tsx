/**
 * `--text-info`: a file's text (`--filename`) or stdin's as it arrives, in a
 * scrolling pane. `--editable` makes it a field, and OK prints what it holds;
 * `--checkbox` adds a box to tick before OK is enabled (a license to accept).
 */

import { glyphs, useColors, useSurface } from "@dashi/ui";
import { ScrollView, Svg, Text, TextInput, View } from "@mirinjs/metal";
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

function Checkbox({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  const colors = useColors();
  return (
    <View testID="dialog:checkbox" onPress={onToggle} style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
      <View
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          borderWidth: on ? 0 : 1.5,
          borderColor: colors.checkbox,
          backgroundColor: on ? colors.selection : "#00000000",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {on && <Svg markup={glyphs.CHECK} size={12} color="#ffffff" />}
      </View>
      <Text style={{ fontSize: 13, color: colors.text }}>{label}</Text>
    </View>
  );
}

export function TextInfoDialog({ spec, answer }: { spec: TextInfoSpec; answer: Answer }) {
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
  const pane = { flex: 1, minHeight: 0, borderRadius: 8, borderWidth: 1, borderColor: colors.separator, backgroundColor: surface.card };
  return (
    <DialogFrame title={spec.title} buttons={buttons} onCancel={() => answer(1)} keys={!spec.editable}>
      {spec.editable ? (
        <TextInput
          testID="dialog:text-info"
          value={text}
          multiline
          autoFocus
          onChangeText={setEdited}
          onKeyPress={(key) => key === "Escape" && answer(1)}
          style={{
            flex: 1,
            minHeight: 0,
            borderRadius: 8,
            borderColor: colors.separator,
            backgroundColor: surface.card,
            padding: 8,
            fontSize: 12,
            color: colors.text,
            focusBorderColor: colors.focusRing,
          }}
        />
      ) : (
        <ScrollView testID="dialog:text-info" style={{ ...pane, flexDirection: "column", padding: 8 }}>
          {text.split("\n").map((line, index) => (
            <Text key={index} style={{ fontSize: 12, color: colors.text, lineHeight: 16 }}>
              {line === "" ? " " : line}
            </Text>
          ))}
        </ScrollView>
      )}
      {spec.checkbox !== null && <Checkbox label={spec.checkbox} on={accepted} onToggle={() => setAccepted((now) => !now)} />}
    </DialogFrame>
  );
}
