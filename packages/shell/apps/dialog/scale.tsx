/**
 * `--scale`: the prompt and Settings' slider, with the value beside it
 * (`--hide-value` leaves it out). The arrow keys step it. OK prints the value;
 * `--print-partial` prints each value as the slider settles on it too.
 */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { Slider } from "../../src/settings-app/ui.tsx";
import { type Answer, DialogFrame, standardButtons } from "./frame.tsx";
import { LAYOUT } from "./size.ts";
import type { ScaleSpec } from "./spec.ts";

const VALUE_WIDTH = 44;

export function ScaleDialog({ spec, answer, width, print }: { spec: ScaleSpec; answer: Answer; width: number; print: (text: string) => void }) {
  const colors = useColors();
  const [value, setValue] = useState(spec.value);
  const range = { min: spec.min, max: spec.max, step: spec.step };
  const change = (next: number): void => {
    const clamped = Math.min(Math.max(next, spec.min), spec.max);
    if (clamped === value) return;
    setValue(clamped);
    if (spec.printPartial) print(`${clamped}\n`);
  };
  const buttons = standardButtons({
    okLabel: spec.okLabel,
    cancelLabel: spec.cancelLabel,
    extraButtons: spec.extraButtons,
    answer,
    onOk: () => answer(0, `${value}\n`),
  });
  const sliderWidth = width - LAYOUT.padding * 2 - (spec.hideValue ? 0 : VALUE_WIDTH + 10);
  return (
    <DialogFrame
      title={spec.title}
      buttons={buttons}
      onCancel={() => answer(1)}
      onKey={(key) => {
        if (key.kind === "up") change(value + spec.step);
        else if (key.kind === "down") change(value - spec.step);
      }}
    >
      {spec.text !== "" && (
        <View testID="dialog:text">
          <Text style={{ fontSize: 13, color: colors.text, lineHeight: 17 }}>{spec.text}</Text>
        </View>
      )}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <Slider testID="dialog:scale" value={value} range={range} width={Math.max(sliderWidth, 80)} onCommit={change} />
        {!spec.hideValue && (
          <View style={{ width: VALUE_WIDTH }}>
            <Text numberOfLines={1} style={{ fontSize: 13, color: colors.text, textAlign: "right" }}>
              {String(value)}
            </Text>
          </View>
        )}
      </View>
    </DialogFrame>
  );
}
