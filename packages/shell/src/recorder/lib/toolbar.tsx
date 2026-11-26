/**
 * ⇧❖5: the screenshot and recording toolbar, as on the Mac. One row at the
 * bottom of the screen: capture the screen, the front window, or an area;
 * record the screen or an area (with the microphone, if switched on); then
 * the button that does it. Return does it too, Escape closes. The toolbar
 * closes before it captures, so it isn't in the picture. While the person's
 * own recording runs, ⇧❖5 stops it instead (and so does the menu bar's stop
 * button, which stops an agent's too); an agent's record_screen leaves the
 * toolbar opening as ever (start.ts), and Record then says "An agent is
 * recording the screen" in the toolbar instead of closing it on nothing.
 * It is regular glass, radius 14 (DE-4, GL-6): a capture's area is never
 * glass, but the toolbar is never in the picture (decisions.md D815).
 */

import { Button, type Choice, Frosted, GlyphButton, Segmented, SHEET_RADIUS, SPACE, TYPE, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { KeyCatcher, type OpenOverlay, type OverlayHandle } from "../../overlay.tsx";
import { CLOSE, CAPTURE_GLYPHS as GLYPHS, MICROPHONE } from "../glyphs.ts";
import type { CaptureMode } from "../types.ts";

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

/** The toolbar's row, and a divider's height in it. */
const WIDTH = 600;
const HEIGHT = 48;
const DIVIDER = 22;

export interface ToolbarChoice {
  mode: CaptureMode;
  microphone: boolean;
}

/** The five modes, one pick (UI-2): glyph segments named by what they capture. */
const MODES: ReadonlyArray<Choice<CaptureMode>> = (["screen", "window", "area", "record-screen", "record-area"] as const).map((mode) => ({
  value: mode,
  label: TITLES[mode],
  glyph: GLYPHS[mode],
}));

function Toolbar({
  initial,
  onDone,
  refuse,
}: {
  initial: ToolbarChoice;
  onDone: (choice: ToolbarChoice | null) => void;
  /** Why this choice can't be done now (an agent is recording), said in the toolbar instead of closing it. */
  refuse?: (choice: ToolbarChoice) => string | null;
}) {
  const colors = useColors();
  const [mode, setMode] = useState(initial.mode);
  const [microphone, setMicrophone] = useState(initial.microphone);
  const [notice, setNotice] = useState<string | null>(null);
  const go = () => {
    const why = refuse?.({ mode, microphone }) ?? null;
    if (why) setNotice(why);
    else onDone({ mode, microphone });
  };
  const choose = (next: CaptureMode) => {
    setNotice(null);
    setMode(next);
  };
  const divider = (key: string) => (
    <View key={key} style={{ width: 1, height: DIVIDER, backgroundColor: colors.separator, marginLeft: SPACE.xs, marginRight: SPACE.xs }} />
  );
  return (
    <Frosted
      level="regular"
      testID="capture-toolbar"
      style={{
        width: WIDTH,
        height: HEIGHT,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.xxs,
        paddingHorizontal: SPACE.m,
        borderRadius: SHEET_RADIUS,
      }}
    >
      <KeyCatcher onKey={(key) => key === "Escape" && onDone(null)} onSubmit={go} />
      <GlyphButton testID="capture-toolbar:close" glyph={CLOSE} label="Close" onPress={() => onDone(null)} />
      {divider("d1")}
      <Segmented testID="capture-toolbar-mode" options={MODES} value={mode} onChange={choose} />
      {divider("d2")}
      <GlyphButton
        testID="capture-toolbar:microphone"
        glyph={MICROPHONE}
        label="Record with the microphone"
        on={microphone && isRecording(mode)}
        disabled={!isRecording(mode)}
        onPress={() => setMicrophone(!microphone)}
      />
      <View testID="capture-toolbar:title" style={{ flex: 1, minWidth: 0, marginLeft: SPACE.s }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: notice ? colors.text : colors.textMuted }}>
          {notice ?? (isRecording(mode) ? `${TITLES[mode]}${microphone ? ", with sound" : ""}` : TITLES[mode])}
        </Text>
      </View>
      <Button testID="capture-toolbar:go" label={ACTION[mode]} primary onPress={go} />
    </Frosted>
  );
}

export interface ToolbarDeps {
  open: OpenOverlay;
  /** The screen to show the toolbar on (the one with the front window). */
  output(): Promise<string | undefined>;
  /** Carry out a choice, after the toolbar's host has exited. */
  act(choice: ToolbarChoice, output: string | undefined): Promise<void>;
  /** Why a choice can't be done now, said in the toolbar, which stays open (start.ts: an agent is recording). */
  refuse?(choice: ToolbarChoice): string | null;
  /** Where a toolbar that didn't show is told (the journal). */
  report?(message: string): void;
  now?(): number;
}

/** A toolbar slower than this to draw its first frame is reported: the person may think ⇧❖5 did nothing. */
export const SLOW_DRAW_MS = 1000;

export interface CaptureToolbar {
  (): void;
  close(): void;
}

/** The toolbar's controller: one toolbar at a time; the last choice is remembered for the next. */
export function captureToolbar(deps: ToolbarDeps): CaptureToolbar {
  let last: ToolbarChoice = { mode: "screen", microphone: false };
  let overlay: OverlayHandle | null = null;
  /** The open toolbar was closed on purpose (a choice, Esc, or `close`), not by its host going. */
  let dismissed = false;
  let busy = false;
  const report = deps.report ?? ((message: string) => console.error(`dashi-shell: ${message}`));
  const now = deps.now ?? (() => performance.now());
  const show = (): void => {
    // One toolbar at a time: a press while one opens (or acts) waits for nothing. Said, so a ⇧❖5
    // that seems to do nothing can be told from one that never came (15-nits, step 7).
    if (busy) return report("⇧❖5: the capture toolbar is still opening or at work; this press does nothing");
    busy = true;
    void (async () => {
      const output = await deps.output();
      let choice: ToolbarChoice | null = null;
      let closed: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        closed = resolve;
      });
      const asked = now();
      let drew: number | null = null;
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
          {...(deps.refuse ? { refuse: deps.refuse } : {})}
          onDone={(chosen) => {
            choice = chosen;
            dismissed = true;
            handle.close();
          }}
        />,
        () => closed(),
        (host) =>
          host.onEvent((event) => {
            const kind: string = event.type;
            if (kind !== "frame" || drew !== null) return;
            drew = now() - asked;
            if (drew > SLOW_DRAW_MS) report(`the capture toolbar took ${Math.round(drew)} ms to show`);
          }),
      );
      overlay = handle;
      await done;
      overlay = null;
      // Gone without ever drawing, and not closed from it: its host failed to show it.
      if (drew === null && choice === null && !dismissed) report("the capture toolbar's window went before it was ever drawn");
      dismissed = false;
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
      if (overlay) dismissed = true;
      overlay?.close();
    },
  });
}
