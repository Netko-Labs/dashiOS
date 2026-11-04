/**
 * `--progress`: the text, the bar, and Cancel and OK, fed from stdin
 * (progress.ts reads the lines). OK waits for 100% or the end of stdin;
 * Cancel exits 1, and with `--auto-kill` hangs up the program that started
 * the dialog, as Zenity does.
 */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useRef, useState } from "react";
import { type Answer, DialogFrame, standardButtons } from "./frame.tsx";
import { applyProgressLine, endProgress, initialProgress, type ProgressState, timeRemaining } from "./progress.ts";
import type { ProgressSpec } from "./spec.ts";
import { readStdinLines } from "./stdin.ts";

const BAR = 6;
/** A pulsing bar's moving part, as a share of the track, and how far it goes each frame. */
const PULSE_WIDTH = 0.28;
const PULSE_STEP = 0.025;
const FRAME_MS = 40;

function Bar({ percentage, pulsate }: { percentage: number; pulsate: boolean }) {
  const colors = useColors();
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!pulsate) return;
    const timer = setInterval(() => setPhase((now) => (now + PULSE_STEP) % 2), FRAME_MS);
    return () => clearInterval(timer);
  }, [pulsate]);
  // Back and forth: 0 to 1 and back again over two units of phase. A pulsing bar's lit
  // part follows a spacer, both in shares of the track.
  const at = phase <= 1 ? phase : 2 - phase;
  const before = pulsate ? at * (1 - PULSE_WIDTH) * 100 : 0;
  const lit = pulsate ? PULSE_WIDTH * 100 : percentage;
  return (
    <View
      testID="dialog:bar"
      style={{ height: BAR, flexShrink: 0, flexDirection: "row", borderRadius: BAR / 2, backgroundColor: colors.track, overflow: "hidden" }}
    >
      <View style={{ width: `${before}%`, flexShrink: 0 }} />
      <View style={{ width: `${lit}%`, flexShrink: 0, borderRadius: BAR / 2, backgroundColor: colors.selection }} />
    </View>
  );
}

export function ProgressDialog({ spec, answer }: { spec: ProgressSpec; answer: Answer }) {
  const colors = useColors();
  const [state, setState] = useState<ProgressState>(() => initialProgress(spec.percentage, spec.text, spec.pulsate));
  const started = useRef(Date.now());
  const { autoClose, noMarkup } = spec;
  useEffect(() => {
    const options = { autoClose, noMarkup };
    return readStdinLines(
      (line) => setState((now) => applyProgressLine(now, line, options)),
      () => setState((now) => endProgress(now, options)),
    );
  }, [autoClose, noMarkup]);
  useEffect(() => {
    if (state.close) answer(0);
  }, [state.close, answer]);
  const cancel = (): void => {
    if (spec.autoKill) {
      try {
        process.kill(process.ppid, "SIGHUP");
      } catch {
        // The parent is gone already.
      }
    }
    answer(1);
  };
  const buttons = standardButtons({
    okLabel: spec.okLabel,
    cancelLabel: spec.cancelLabel,
    extraButtons: spec.extraButtons,
    answer,
    onOk: () => answer(0),
    okDisabled: !state.finished,
    noCancel: spec.noCancel,
  }).map((button) => (button.testID === "dialog:cancel" ? { ...button, onPress: cancel } : button));
  const remaining = spec.timeRemaining ? timeRemaining(Date.now() - started.current, state.percentage) : null;
  return (
    <DialogFrame title={spec.title} buttons={buttons} onCancel={spec.noCancel ? () => {} : cancel}>
      {state.text !== "" && (
        <View testID="dialog:text">
          <Text style={{ fontSize: 13, color: colors.text, lineHeight: 17 }}>{state.text}</Text>
        </View>
      )}
      <Bar percentage={state.percentage} pulsate={state.pulsate} />
      {spec.timeRemaining && (
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textMuted }}>
          {remaining ?? " "}
        </Text>
      )}
    </DialogFrame>
  );
}
