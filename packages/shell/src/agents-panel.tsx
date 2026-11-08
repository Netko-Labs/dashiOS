/**
 * Agents from the launcher in the menu bar (docs/actions.md, "Agents from
 * the launcher"): one chip while any works (agents/handoff/chip.ts), amber
 * while one needs the person, and its panel: each run's card, newest
 * first, with its last three steps (never a transcript), the question it
 * waits on (answered here, not in a sheet over the person's work), Show
 * (the whole log in its own window), Stop, and for an hour after it ends,
 * Undo where its changes can be put back.
 */

import { useColors } from "@dashi/ui";
import { ScrollView, Svg, Text, View } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import { chipState } from "./agents/handoff/chip.ts";
import { harnessGlyph } from "./agents/handoff/harness-icons.ts";
import { type AgentRuns, CARD_STEPS, isWorking, progressWords, type RunQuestion, type RunView } from "./agents/handoff/store.ts";
import { cut } from "./agents/handoff/words.ts";
import { KeyCatcher } from "./overlay.tsx";

export const AGENTS_PANEL = { width: 380, padding: 6, radius: 12 } as const;
/** The chip's harness mark, where an 8 px dot was. */
const CHIP_GLYPH = 12;

export function useRuns(runs: Pick<AgentRuns, "subscribe" | "getSnapshot">): readonly RunView[] {
  return useSyncExternalStore(runs.subscribe, runs.getSnapshot);
}

/** The menu bar's chip: its run's harness mark and words, shiso while agents work, amber (broth) while one needs you; a click opens the panel. */
export function AgentsChip({ runs, open, onPress }: { runs: Pick<AgentRuns, "subscribe" | "getSnapshot">; open: boolean; onPress: (right: number) => void }) {
  const colors = useColors();
  const chip = chipState(useRuns(runs));
  if (!chip) return null;
  return (
    <View
      testID="agents-chip"
      onPress={({ bounds }) => onPress(bounds ? bounds.x + bounds.width : 0)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        height: 20,
        paddingLeft: 7,
        paddingRight: 8,
        borderRadius: 10,
        flexShrink: 1,
        minWidth: 0,
        backgroundColor: chip.attention ? colors.brothWash : open ? colors.agent : colors.agentWash,
      }}
    >
      <Svg markup={harnessGlyph(chip.harness)} size={CHIP_GLYPH} color={chip.attention ? colors.broth : open ? "#ffffff" : colors.agent} />
      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "semibold", color: chip.attention ? colors.broth : open ? "#ffffff" : colors.agentInk }}>
        {chip.words}
      </Text>
    </View>
  );
}

function Small({ label, primary, danger, testID, onPress }: { label: string; primary?: true; danger?: true; testID: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onPress={onPress}
      style={{
        height: 24,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 6,
        justifyContent: "center",
        backgroundColor: primary ? colors.selection : colors.button,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: "semibold", color: primary ? "#ffffff" : danger ? colors.criticalInk : colors.text }}>{label}</Text>
    </View>
  );
}

const minutes = (from: number, to: number): string => {
  const gone = Math.max(0, Math.round((to - from) / 60_000));
  return gone < 1 ? "now" : `${gone} min`;
};

const clock = (at: number): string => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** The card's second line: "Claude Code · 2 min · step 3 of about 6", or how it ended. */
export function cardLine(run: RunView, now: number): string {
  if (run.ended === null) return [run.harnessName, minutes(run.started, now), progressWords(run)].join(" · ");
  const end = clock(run.ended);
  if (run.phase === "done") return [`Done ${end}`, run.summary ? cut(run.summary.split("\n")[0] ?? "", 60) : ""].filter(Boolean).join(" · ");
  if (run.phase === "stopped") return `Stopped ${end}`;
  return [`Stopped ${end}`, run.error ? cut(run.error, 60) : ""].filter(Boolean).join(" · ");
}

function QuestionBox({ run, question, onAnswer }: { run: RunView; question: RunQuestion; onAnswer: (choice: string) => void }) {
  const colors = useColors();
  return (
    <View
      testID={`agents-question:${run.id}`}
      style={{ flexDirection: "column", gap: 4, marginTop: 6, padding: 9, borderRadius: 9, backgroundColor: colors.brothWash }}
    >
      <Text style={{ fontSize: 12.5, fontWeight: "semibold", color: colors.text }}>{question.title}</Text>
      {question.detail && <Text style={{ fontSize: 12, color: colors.textMuted }}>{question.detail}</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
        {question.choices.map((choice) => (
          <Small
            key={choice.id}
            testID={`agents-answer:${run.id}:${choice.id}`}
            label={choice.label}
            {...(choice.primary ? { primary: true as const } : {})}
            {...(choice.danger ? { danger: true as const } : {})}
            onPress={() => onAnswer(choice.id)}
          />
        ))}
      </View>
    </View>
  );
}

export interface PanelActions {
  answer(run: string, question: string, choice: string): void;
  stop(run: string): void;
  show(run: string): void;
  undo(run: string, index: number): void;
}

function RunCard({ run, now, first, focused, actions }: { run: RunView; now: number; first: boolean; focused: boolean; actions: PanelActions }) {
  const colors = useColors();
  const working = isWorking(run);
  const steps = run.steps.slice(-CARD_STEPS);
  const undos = run.undos.flatMap((entry, index) => (entry.undone ? [] : [{ index, title: entry.undo.title }]));
  return (
    <View
      testID={`agents-card:${run.id}`}
      style={{
        flexDirection: "row",
        gap: 10,
        padding: 10,
        borderRadius: 9,
        ...(first ? {} : { borderTopWidth: 1, borderColor: colors.separator }),
        ...(focused ? { backgroundColor: colors.selectionWash } : {}),
        ...(working ? {} : { opacity: 0.8 }),
      }}
    >
      <View style={{ width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: colors.agentWash }}>
        <Svg markup={harnessGlyph(run.harness)} size={15} color={colors.agent} />
      </View>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 2 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
          {cut(run.request, 60)}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.textMuted }}>
          {cardLine(run, now)}
        </Text>
        {working &&
          steps.map((step) => (
            <View key={step.id} style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 18 }}>
              <View style={{ width: 12, alignItems: "center" }}>
                {step.state === "running" ? (
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: colors.agent }} />
                ) : (
                  <Text style={{ fontSize: 11, color: step.state === "done" ? colors.textMuted : colors.criticalInk }}>
                    {step.state === "done" ? "✓" : "✕"}
                  </Text>
                )}
              </View>
              <Text numberOfLines={1} style={{ fontSize: 12, color: step.state === "running" ? colors.text : colors.textMuted }}>
                {step.words}
              </Text>
            </View>
          ))}
        {run.question && <QuestionBox run={run} question={run.question} onAnswer={(choice) => actions.answer(run.id, run.question?.id ?? "", choice)} />}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          <Small testID={`agents-show:${run.id}`} label="Show" onPress={() => actions.show(run.id)} />
          {working && <Small testID={`agents-stop:${run.id}`} label="Stop" danger onPress={() => actions.stop(run.id)} />}
          {!working &&
            undos.map((undo) => (
              <Small
                key={undo.index}
                testID={`agents-undo:${run.id}:${undo.index}`}
                label={`Undo: ${undo.title}`}
                onPress={() => actions.undo(run.id, undo.index)}
              />
            ))}
        </View>
      </View>
    </View>
  );
}

/** The panel under the chip: every run's card, newest first (one waiting on you on top). */
export function AgentsPanel({
  runs,
  right,
  focus,
  actions,
  onClose,
}: {
  runs: Pick<AgentRuns, "subscribe" | "getSnapshot">;
  right: number;
  focus: string | null;
  actions: PanelActions;
  onClose: () => void;
}) {
  const colors = useColors();
  const all = useRuns(runs);
  const now = Date.now();
  const shown = [...all].sort((a, b) => Number(b.question !== null) - Number(a.question !== null) || b.started - a.started);
  return (
    <View
      testID="agents-panel"
      style={{
        position: "absolute",
        top: 4,
        // Under the chip's right end; at the screen's right edge when it didn't say (a notification's Show).
        ...(right > 0 ? { left: Math.max(8, right - AGENTS_PANEL.width) } : { right: 8 }),
        width: AGENTS_PANEL.width,
        maxHeight: 560,
        flexDirection: "column",
        padding: AGENTS_PANEL.padding,
        borderRadius: AGENTS_PANEL.radius,
        borderWidth: 1,
        borderColor: colors.separator,
        backgroundColor: colors.launcher,
        shadow: "xl",
      }}
    >
      <KeyCatcher onKey={(key) => key === "Escape" && onClose()} />
      {shown.length === 0 ? (
        <View style={{ padding: 12 }}>
          <Text style={{ fontSize: 12.5, color: colors.textMuted }}>No agents in the last hour. Type a task in the launcher to hand it off.</Text>
        </View>
      ) : (
        <ScrollView style={{ flexShrink: 1 }}>
          {shown.map((run, index) => (
            <RunCard key={run.id} run={run} now={now} first={index === 0} focused={run.id === focus && shown.length > 1} actions={actions} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
