/**
 * "Keep these display settings?": the question after a change that could
 * leave a screen unreadable. It counts down; the old arrangement comes back
 * when the time is up (manager.ts), so a screen that shows nothing needs no
 * one to answer. A shell overlay on the main screen, like the other sheets;
 * agent input never reaches it (agents drive windows, not layer surfaces).
 */

import { AlertSheet, INFO, KeySink, TYPE, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import type { OpenOverlay } from "../overlay.tsx";
import type { AskToKeep, KeepAsk } from "./lib/trial.ts";

export const KEEP_SHEET = { width: 440, height: 190 } as const;
/** How often the count down looks at the clock. */
const TICK_MS = 250;
const WIDTH = KEEP_SHEET.width - 40;

/** Whole seconds left, never below zero. */
export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/**
 * The alert frame (UI-5) on its own surface: the question, what changed, the
 * count down, "Go back" (what Esc presses) and "Keep". It never takes the
 * keyboard by itself, so Enter typed elsewhere can't keep a change.
 */
export function KeepSheet({ ask }: { ask: KeepAsk }) {
  const colors = useColors();
  const [left, setLeft] = useState(() => secondsLeft(ask.deadline, Date.now()));
  useEffect(() => {
    const timer = setInterval(() => setLeft(secondsLeft(ask.deadline, Date.now())), TICK_MS);
    return () => clearInterval(timer);
  }, [ask.deadline]);
  return (
    <AlertSheet
      testID="display-keep"
      place="screen"
      keys={false}
      width={WIDTH}
      question="Keep these display settings?"
      message={ask.summary}
      glyph={INFO}
      buttons={[
        { label: "Go back", testID: "display-keep-back", onPress: () => ask.answer(false), cancel: true },
        { label: "Keep", testID: "display-keep-keep", onPress: () => ask.answer(true), kind: "primary", isDefault: false },
      ]}
    >
      <KeySink testID="display-keep:esc" onKey={(key) => key.kind === "escape" && ask.answer(false)} />
      <View testID="display-keep-left">
        <Text style={{ fontSize: TYPE.body.size, lineHeight: TYPE.body.line, color: colors.text }}>
          {`Going back in ${left} ${left === 1 ? "second" : "seconds"} if you do nothing.`}
        </Text>
      </View>
    </AlertSheet>
  );
}

/** The question as a sheet on the main display (`output` names it; the compositor's choice when it does not). */
export function keepSheet(open: OpenOverlay, output: () => string | undefined): AskToKeep {
  return (ask) => {
    const where = output();
    const handle = open(
      {
        title: "Display settings",
        width: KEEP_SHEET.width,
        height: KEEP_SHEET.height,
        // On demand: the sheet never takes the keyboard by itself, so a stray Enter typed elsewhere can't answer it.
        surface: { layer: "overlay", keyboard: "on-demand", namespace: "dashi.display-keep", ...(where === undefined ? {} : { output: where }) },
      },
      <KeepSheet ask={ask} />,
      // A sheet that died unanswered is a no.
      () => {
        console.error("KEEP closed");
        ask.answer(false);
      },
    );
    console.error("KEEP opened");
    return () => handle.close();
  };
}
