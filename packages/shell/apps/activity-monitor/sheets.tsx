/**
 * Activity Monitor's sheets: Quit (an app or a process; no Return default,
 * so a Return meant for something else can't end anything, UI-6), "still
 * running" (offered when a quit app outlives `STILL_RUNNING_MS`), the refusal,
 * and Inspect (what a process is: its command line, parent, start, state).
 * A name in a question is cut in the middle to keep the question on one line
 * (`questionFor`), never broken mid-word; Inspect's facts scroll inside a window
 * too short for them, its Done always in reach.
 */

import { ALERT_WINDOW, AlertSheet, alertWordsWidth, glyphs, useColors } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import { formatBytes, formatCpuTime, formatPercent, formatState, middleCut } from "./format.ts";
import type { Line } from "./lines.ts";
import type { QuitSignal } from "./policy.ts";

/**
 * The question `ask` makes of `name`, the name cut in the middle to keep it
 * on the one line of a sheet `width` wide. The words around the name are
 * counted from `ask` itself, so a question's wording and its cut never part.
 */
export function questionFor(name: string, width: number, ask: (name: string) => string): string {
  const around = [...ask("")].length;
  // alertWordsWidth is the words' width in a sheet: its padding (20, as AlertWindow's 18 and a little) and the tile beside them.
  return ask(middleCut(name, Math.max(Math.floor(alertWordsWidth(width) / ALERT_WINDOW.question.char) - around, 12)));
}

const QUIT_WIDTH = 420;
const NOTICE_WIDTH = 400;
const INSPECT_WIDTH = 480;

export function QuitSheet({ line, onAnswer }: { line: Line; onAnswer: (signal: QuitSignal | null) => void }) {
  const app = line.kind === "app";
  return (
    <AlertSheet
      testID="quit-sheet"
      width={QUIT_WIDTH}
      question={questionFor(line.name, QUIT_WIDTH, (name) => `Quit “${name}”?`)}
      message={`${app ? "The app will close" : "It will be asked to close"}. Force quit ends it immediately, and anything unsaved is lost.`}
      glyph={glyphs.STOP}
      tone="danger"
      buttons={[
        { label: "Cancel", testID: "quit-sheet:cancel", onPress: () => onAnswer(null), cancel: true },
        { label: "Force quit", testID: "quit-sheet:force", onPress: () => onAnswer("SIGKILL"), kind: "danger" },
        // Esc cancels; Return presses nothing here, so a Return meant for something else can't end a process.
        // So no button wears the default's kombu either: Quit is in ink, like Cancel.
        { label: "Quit", testID: "quit-sheet:quit", onPress: () => onAnswer("SIGTERM"), isDefault: false },
      ]}
    />
  );
}

export function StillRunningSheet({ name, onAnswer }: { name: string; onAnswer: (force: boolean) => void }) {
  return (
    <AlertSheet
      testID="still-running-sheet"
      width={NOTICE_WIDTH}
      question={questionFor(name, NOTICE_WIDTH, (cut) => `“${cut}” is still running.`)}
      message="Force quit ends it immediately, and anything unsaved is lost."
      glyph={glyphs.WARNING}
      tone="danger"
      buttons={[
        { label: "Wait", testID: "still-running-sheet:wait", onPress: () => onAnswer(false), cancel: true },
        { label: "Force quit", testID: "still-running-sheet:force", onPress: () => onAnswer(true), kind: "danger", isDefault: false },
      ]}
    />
  );
}

export function RefusedSheet({ name, reason, onClose }: { name: string; reason: string; onClose: () => void }) {
  // It only informs: one button, which Esc and Enter press too (UI-5).
  return (
    <AlertSheet
      testID="refused-sheet"
      width={NOTICE_WIDTH}
      question={questionFor(name, NOTICE_WIDTH, (cut) => `“${cut}” can’t be quit from here.`)}
      message={reason}
      glyph={glyphs.INFO}
      buttons={[{ label: "OK", testID: "refused-sheet:ok", onPress: onClose, kind: "primary" }]}
    />
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
      <View style={{ width: 92, flexShrink: 0 }}>
        <Text style={{ fontSize: 12, color: colors.textMuted }}>{label}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 12, color: colors.text }}>{value}</Text>
      </View>
    </View>
  );
}

/**
 * The most Inspect's facts may take in a window `windowHeight` tall whose
 * sheets hang `top` from its top: the rest is the sheet's frame, its one-line
 * question (and message), and Done, which must stay in the window.
 */
export function factsRoom(windowHeight: number, top: number, hasMessage: boolean): number {
  const hang = top + 8; // Sheet's marginTop
  const card = 20 * 2; // SheetCard's padding
  const words = 17 + (hasMessage ? 4 + 16 : 0) + 4 + 6; // the question, the message, the gap and margin over the facts
  const buttons = 10 + 6 + 28; // the gap over the button row, its margin, a button
  const under = 8; // room under the sheet
  return Math.max(Math.floor(windowHeight - hang - card - words - buttons - under), 80);
}

/** What a line is, in words: Inspect (❖I, Return, a double click). `maxFacts` bounds the facts, which scroll past it. */
export function InspectSheet({ line, parentName, onClose, maxFacts }: { line: Line; parentName: string | null; onClose: () => void; maxFacts: number }) {
  const process = line.process;
  const facts: Array<[string, string]> = [];
  if (line.kind === "app") facts.push(["Processes", String(line.members.length)]);
  if (process) {
    facts.push(
      ["Process ID", String(process.pid)],
      ["Parent", parentName ? `${parentName} (${process.ppid})` : String(process.ppid)],
      ["State", formatState(process.state)],
      ["Command", process.command || "—"],
    );
  }
  facts.push(
    ["User", line.user],
    ["% CPU", formatPercent(line.cpu)],
    ["CPU time", formatCpuTime(line.cpuTime)],
    ["Memory", formatBytes(line.memory)],
    ["Threads", String(line.threads)],
  );
  return (
    <AlertSheet
      testID="inspect-sheet"
      width={INSPECT_WIDTH}
      question={questionFor(line.name, INSPECT_WIDTH, (name) => name)}
      message={line.kind === "app" && line.members.length > 1 ? "The app and its helpers, added up." : undefined}
      glyph={glyphs.INFO}
      buttons={[{ label: "Done", testID: "inspect-sheet:done", onPress: onClose, kind: "primary" }]}
    >
      <ScrollView testID="inspect-sheet:facts" style={{ maxHeight: maxFacts, flexDirection: "column", gap: 8 }}>
        {facts.map(([label, value]) => (
          <Fact key={label} label={label} value={value} />
        ))}
      </ScrollView>
    </AlertSheet>
  );
}
