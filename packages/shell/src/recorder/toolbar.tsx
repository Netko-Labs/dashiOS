/**
 * ⇧❖5: the screenshot and recording toolbar, as on the Mac. One row at the
 * bottom of the screen: capture the screen, the front window, or an area;
 * record the screen or an area (with the microphone, if switched on); then
 * the button that does it. Return does it too, Escape closes. The toolbar
 * closes before it captures, so it isn't in the picture. While the person's
 * own recording runs, ⇧❖5 stops it instead (and so does the menu bar's stop
 * button, which stops an agent's too); an agent's record_screen leaves the
 * toolbar opening as ever (start.ts).
 */

import { useColors } from "@dashi/ui";
import { Svg, Text, TextInput, View } from "@mirinjs/metal";
import { useState } from "react";
import type { OpenOverlay, OverlayHandle } from "../overlay.tsx";
import { CLOSE, CAPTURE_GLYPHS as GLYPHS, MICROPHONE } from "./glyphs.ts";

export type CaptureMode = "screen" | "window" | "area" | "record-screen" | "record-area";

/** What the button says for each mode. */
export const ACTION: Record<CaptureMode, string> = {
  screen: "Capture",
  window: "Capture Window",
  area: "Capture Area",
  "record-screen": "Record",
  "record-area": "Record Area",
};

const TITLES: Record<CaptureMode, string> = {
  screen: "Capture the entire screen",
  window: "Capture the front window",
  area: "Capture an area",
  "record-screen": "Record the entire screen",
  "record-area": "Record an area",
};

export const isRecording = (mode: CaptureMode): boolean => mode === "record-screen" || mode === "record-area";

const WIDTH = 600;
const HEIGHT = 48;

export interface ToolbarChoice {
  mode: CaptureMode;
  microphone: boolean;
}

function Toolbar({ initial, onDone }: { initial: ToolbarChoice; onDone: (choice: ToolbarChoice | null) => void }) {
  const colors = useColors();
  const [mode, setMode] = useState(initial.mode);
  const [microphone, setMicrophone] = useState(initial.microphone);
  const go = () => onDone({ mode, microphone });
  const button = (key: string, chosen: boolean, glyph: string, onPress: () => void, testID: string) => (
    <View
      key={key}
      testID={testID}
      onPress={onPress}
      style={{
        width: 34,
        height: 30,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: chosen ? colors.selection : "#00000000",
        hoverBackgroundColor: chosen ? colors.selection : colors.button,
      }}
    >
      <Svg markup={glyph} size={18} color={chosen ? "#ffffff" : colors.text} />
    </View>
  );
  const divider = (key: string) => <View key={key} style={{ width: 1, height: 22, backgroundColor: colors.separator, marginLeft: 4, marginRight: 4 }} />;
  return (
    <View
      testID="capture-toolbar"
      style={{
        width: WIDTH,
        height: HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        paddingHorizontal: 8,
        borderRadius: 12,
        backgroundColor: colors.menu,
        borderWidth: 1,
        borderColor: colors.separator,
      }}
    >
      {/* Keys reach Metal only through a focused text input. */}
      <View style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, opacity: 0, overflow: "hidden" }}>
        <TextInput
          value=""
          autoFocus
          onSubmitEditing={go}
          onKeyPress={(key) => {
            if (key === "Escape") onDone(null);
          }}
          style={{ width: 1, height: 1, backgroundColor: "#00000000" }}
        />
      </View>
      {button("close", false, CLOSE, () => onDone(null), "capture-toolbar:close")}
      {divider("d1")}
      {(["screen", "window", "area"] as const).map((each) => button(each, mode === each, GLYPHS[each], () => setMode(each), `capture-toolbar:${each}`))}
      {divider("d2")}
      {(["record-screen", "record-area"] as const).map((each) => button(each, mode === each, GLYPHS[each], () => setMode(each), `capture-toolbar:${each}`))}
      {divider("d3")}
      <View style={{ opacity: isRecording(mode) ? 1 : 0.35 }}>
        {button("microphone", microphone && isRecording(mode), MICROPHONE, () => isRecording(mode) && setMicrophone(!microphone), "capture-toolbar:microphone")}
      </View>
      <View style={{ flex: 1, minWidth: 0, marginLeft: 6 }}>
        <Text numberOfLines={1} style={{ fontSize: 11.5, color: colors.textMuted }}>
          {isRecording(mode) ? `${TITLES[mode]}${microphone ? ", with sound" : ""}` : TITLES[mode]}
        </Text>
      </View>
      <View
        testID="capture-toolbar:go"
        onPress={go}
        style={{ height: 30, paddingHorizontal: 14, borderRadius: 7, justifyContent: "center", backgroundColor: colors.selection }}
      >
        <Text style={{ fontSize: 13, fontWeight: "semibold", color: "#ffffff" }}>{ACTION[mode]}</Text>
      </View>
    </View>
  );
}

export interface ToolbarDeps {
  open: OpenOverlay;
  /** The screen to show the toolbar on (the one with the front window). */
  output(): Promise<string | undefined>;
  /** Carry out a choice, after the toolbar's host has exited. */
  act(choice: ToolbarChoice, output: string | undefined): Promise<void>;
}

export interface CaptureToolbar {
  (): void;
  close(): void;
}

/** The toolbar's controller: one toolbar at a time; the last choice is remembered for the next. */
export function captureToolbar(deps: ToolbarDeps): CaptureToolbar {
  let last: ToolbarChoice = { mode: "screen", microphone: false };
  let overlay: OverlayHandle | null = null;
  let busy = false;
  const show = (): void => {
    if (busy) return;
    busy = true;
    void (async () => {
      const output = await deps.output();
      let choice: ToolbarChoice | null = null;
      let closed: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        closed = resolve;
      });
      const handle = deps.open(
        {
          title: "Screenshot",
          width: WIDTH,
          height: HEIGHT,
          surface: {
            layer: "overlay",
            anchor: ["bottom"],
            margin: { bottom: 96 },
            keyboard: "exclusive",
            namespace: "dashi.capture-toolbar",
            ...(output === undefined ? {} : { output }),
          },
        },
        <Toolbar
          initial={last}
          onDone={(chosen) => {
            choice = chosen;
            handle.close();
          }}
        />,
        () => closed(),
      );
      overlay = handle;
      await done;
      overlay = null;
      await handle.exited;
      if (choice === null) return;
      last = choice;
      await deps.act(choice, output);
    })()
      .catch((error) => console.error("dashi-shell: the capture toolbar failed:", error))
      .finally(() => {
        busy = false;
      });
  };
  return Object.assign(show, {
    close() {
      overlay?.close();
    },
  });
}
