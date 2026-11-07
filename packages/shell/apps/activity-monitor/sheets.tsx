/**
 * Activity Monitor's sheets: Quit (an app or a process; no Return default,
 * so a Return meant for something else can't end anything, UI-6), "still
 * running" (offered when a quit app outlives `STILL_RUNNING_MS`), the refusal,
 * and Inspect (what a process is: its command line, parent, start, state).
 */

import { AlertSheet, glyphs, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { formatBytes, formatCpuTime, formatPercent, formatState } from "./format.ts";
import type { Line } from "./lines.ts";
import type { QuitSignal } from "./policy.ts";

export function QuitSheet({ line, onAnswer }: { line: Line; onAnswer: (signal: QuitSignal | null) => void }) {
  const app = line.kind === "app";
  return (
    <AlertSheet
      testID="quit-sheet"
      width={420}
      question={`Quit “${line.name}”?`}
      message={`${app ? `${line.name} will close` : "It will be asked to close"}. Force quit ends it immediately, and anything unsaved is lost.`}
      glyph={glyphs.STOP}
      tone="danger"
      buttons={[
        { label: "Cancel", testID: "quit-sheet:cancel", onPress: () => onAnswer(null), cancel: true },
        { label: "Force quit", testID: "quit-sheet:force", onPress: () => onAnswer("SIGKILL"), kind: "danger" },
        // Esc cancels; Return presses nothing here, so a Return meant for something else can't end a process.
        { label: "Quit", testID: "quit-sheet:quit", onPress: () => onAnswer("SIGTERM"), kind: "primary", isDefault: false },
      ]}
    />
  );
}

export function StillRunningSheet({ name, onAnswer }: { name: string; onAnswer: (force: boolean) => void }) {
  return (
    <AlertSheet
      testID="still-running-sheet"
      width={400}
      question={`“${name}” is still running.`}
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
      width={400}
      question={`“${name}” can’t be quit from here.`}
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

/** What a line is, in words: Inspect (❖I, Return, a double click). */
export function InspectSheet({ line, parentName, onClose }: { line: Line; parentName: string | null; onClose: () => void }) {
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
      width={480}
      question={line.name}
      message={line.kind === "app" && line.members.length > 1 ? `${line.name} and its helpers, added up.` : undefined}
      glyph={glyphs.INFO}
      buttons={[{ label: "Done", testID: "inspect-sheet:done", onPress: onClose, kind: "primary" }]}
    >
      {facts.map(([label, value]) => (
        <Fact key={label} label={label} value={value} />
      ))}
    </AlertSheet>
  );
}
