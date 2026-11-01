/**
 * "Keep these display settings?": the question after a change that could
 * leave a screen unreadable. It counts down; the old arrangement comes back
 * when the time is up (manager.ts), so a screen that shows nothing needs no
 * one to answer. A shell overlay on the main screen, like the other sheets;
 * agent input never reaches it (agents drive windows, not layer surfaces).
 */

import { Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { Button } from "../consent.tsx";
import type { OpenOverlay } from "../overlay.tsx";
import { useColors } from "../theme.ts";
import type { AskToKeep, KeepAsk } from "./manager.ts";

export const KEEP_SHEET = { width: 440, height: 190 } as const;

/** Whole seconds left, never below zero. */
export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function KeepSheet({ ask }: { ask: KeepAsk }) {
  const colors = useColors();
  const [left, setLeft] = useState(() => secondsLeft(ask.deadline, Date.now()));
  useEffect(() => {
    const timer = setInterval(() => setLeft(secondsLeft(ask.deadline, Date.now())), 250);
    return () => clearInterval(timer);
  }, [ask.deadline]);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <View
        occlude
        testID="display-keep"
        style={{
          width: KEEP_SHEET.width - 40,
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          padding: 20,
          borderRadius: 18,
          backgroundColor: colors.launcher,
          borderWidth: 1,
          borderColor: colors.dockBorder,
          shadow: "xl",
        }}
      >
        <Text style={{ fontSize: 16, fontWeight: "bold", color: colors.text, textAlign: "center" }}>Keep these display settings?</Text>
        <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>{ask.summary}</Text>
        <View testID="display-keep-left" style={{ marginTop: 8 }}>
          <Text style={{ fontSize: 13, color: colors.text, textAlign: "center" }}>
            {`Going back in ${left} ${left === 1 ? "second" : "seconds"} if you do nothing.`}
          </Text>
        </View>
        <View style={{ alignSelf: "stretch", flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <Button label="Go Back" onPress={() => ask.answer(false)} />
          <Button label="Keep" primary onPress={() => ask.answer(true)} />
        </View>
      </View>
    </View>
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
