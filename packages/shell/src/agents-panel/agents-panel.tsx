/**
 * The agents' panel, under the menu bar's agent mark (agent-mark.tsx;
 * docs/actions.md, "Agents from the launcher"): every agent in one place.
 * A run from the launcher is its card, newest first, with its last three
 * steps (never a transcript), the question it waits on (answered here, not
 * in a sheet over the person's work), Show (the whole log in its own
 * window), Stop, and for an hour after it ends, Undo where its changes can
 * be put back. An agent connected from outside is a row (lib/agents-rows.tsx),
 * one for all its sessions: what it may see or do now, where it's from, Stop.
 * Connections that have called nothing are a quiet line at the foot. "Stop
 * all" stops them all, as ⌃❖Esc does.
 */

import { CHECK, CLOSE, OPACITY, RADIUS, SHADOW, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { ScrollView, Svg, Text, View } from "@mirinjs/metal";
import { useContext, useSyncExternalStore } from "react";
import {
  type AgentEntry,
  type AgentInfo,
  type AgentRuns,
  CARD_STEPS,
  cut,
  harnessGlyph,
  idleConnections,
  isWorking,
  mergeAgents,
  progressWords,
  type RunQuestion,
  type RunView,
  type TaskView,
} from "../agents/index.ts";
import { KeyCatcher } from "../overlay.tsx";
import { AccessChip, ConnectionRow, IdleLine, NoAgents, Small, StopAllFooter, TileDot } from "./lib/agents-rows.tsx";
import { panelTaskList, TaskCard, taskCardFocus, taskWorks } from "./lib/task-cards.tsx";
import { type PanelTasks, PanelTasksContext } from "./tasks.tsx";

export const AGENTS_PANEL = { width: 380, padding: SPACE.s, radius: RADIUS.sheet } as const;
/** A step's done or failed mark: a glyph on the 16 grid (IC-3). */
const STEP_MARK = 11;

/** The panel's ground: the menu's tint without its alpha. */
const PANEL_GROUND = (colors: ReturnType<typeof useColors>): string => colors.menu.slice(0, 7);

export function useRuns(runs: Pick<AgentRuns, "subscribe" | "getSnapshot">): readonly RunView[] {
  return useSyncExternalStore(runs.subscribe, runs.getSnapshot);
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
      style={{ flexDirection: "column", gap: SPACE.xs, marginTop: SPACE.s, padding: SPACE.m, borderRadius: RADIUS.card, backgroundColor: colors.brothWash }}
    >
      <Text style={{ fontSize: TYPE.panel.body.size, fontWeight: WEIGHT.semibold, color: colors.text }}>{question.title}</Text>
      {question.detail && <Text style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>{question.detail}</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.s, marginTop: SPACE.xs }}>
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
  /** Cut a connected agent off (its StoppedNote follows). */
  stopAgent(id: number): void;
  /** Go to the Desktop a connected agent works on (its row's Show). */
  showSpace?(space: number): void;
  /** Every working run and every connected agent, as ⌃❖Esc. */
  stopAll(): void;
}

/** One step of a run at work: a dot while it runs, a tick or a cross once it ends. */
function StepRow({ step }: { step: RunView["steps"][number] }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s, height: 18 }}>
      <View style={{ width: 12, alignItems: "center" }}>
        {step.state === "running" ? (
          <View style={{ width: 7, height: 7, borderRadius: RADIUS.check, backgroundColor: colors.agent }} />
        ) : (
          <Svg markup={step.state === "done" ? CHECK : CLOSE} size={STEP_MARK} color={step.state === "done" ? colors.textMuted : colors.criticalInk} />
        )}
      </View>
      <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, color: step.state === "running" ? colors.text : colors.textMuted }}>
        {step.words}
      </Text>
    </View>
  );
}

interface RunCardProps {
  run: RunView;
  /** It as the mark sees it, while it works: what its connection sees. */
  entry?: AgentEntry;
  now: number;
  first: boolean;
  focused: boolean;
  actions: PanelActions;
}

function RunCard({ run, entry, now, first, focused, actions }: RunCardProps) {
  const colors = useColors();
  const working = isWorking(run);
  const steps = run.steps.slice(-CARD_STEPS);
  const undos = run.undos.flatMap((entry, index) => (entry.undone ? [] : [{ index, title: entry.undo.title }]));
  return (
    <View
      testID={`agents-card:${run.id}`}
      style={{
        flexDirection: "row",
        gap: SPACE.gap,
        padding: SPACE.gap,
        borderRadius: RADIUS.card,
        ...(first ? {} : { borderTopWidth: 1, borderColor: colors.separator }),
        ...(focused ? { backgroundColor: colors.selectionWash } : {}),
        ...(working ? {} : { opacity: OPACITY.soft }),
      }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: RADIUS.control,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.agentWash,
          position: "relative",
        }}
      >
        <Svg markup={harnessGlyph(run.harness)} size={15} color={colors.agent} />
        {entry?.watching && <TileDot ring={PANEL_GROUND(colors)} />}
      </View>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: SPACE.xxs }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: colors.text }}>
          {cut(run.request, 60)}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, color: colors.textMuted }}>
          {cardLine(run, now)}
        </Text>
        {entry?.watching && (
          <View style={{ flexDirection: "row", marginTop: SPACE.xxs }}>
            <AccessChip entry={entry} />
          </View>
        )}
        {working && steps.map((step) => <StepRow key={step.id} step={step} />)}
        {run.question && <QuestionBox run={run} question={run.question} onAnswer={(choice) => actions.answer(run.id, run.question?.id ?? "", choice)} />}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: SPACE.s, marginTop: SPACE.s }}>
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

const NEVER = () => () => {};
const NONE: readonly TaskView[] = [];
const NO_TASKS = (): readonly TaskView[] => NONE;

/** The launcher's Ask tasks (tasks.tsx): what a click on a task's capsule in the bar opens. */
function usePanelTasks(): { source: PanelTasks | null; tasks: TaskView[]; working: TaskView[] } {
  const source = useContext(PanelTasksContext);
  const tasks = panelTaskList(useSyncExternalStore(source?.subscribe ?? NEVER, source ? source.getSnapshot : NO_TASKS));
  return { source, tasks, working: tasks.filter(taskWorks) };
}

function TaskCards({ tasks, source, focus }: { tasks: readonly TaskView[]; source: PanelTasks; focus: string | null }) {
  return tasks.map((task, index) => <TaskCard key={task.id} task={task} first={index === 0} focused={taskCardFocus(task.id) === focus} tasks={source} />);
}

/** Stop all: every Ask task still at work, then every run and connection (which also closes the panel). */
function stopAll(actions: PanelActions, tasks: PanelTasks | null, working: readonly string[]): void {
  for (const id of working) tasks?.stop(id);
  actions.stopAll();
}

/** The panel under the mark: agents waiting on the person first, then working, then connected; then the runs that ended in the last hour. */
export function AgentsPanel({
  runs,
  agents,
  right,
  focus,
  actions,
  onClose,
}: {
  runs: Pick<AgentRuns, "subscribe" | "getSnapshot">;
  /** Who is connected (agents/presence.ts). */
  agents: { subscribe(listener: () => void): () => void; getSnapshot(): readonly AgentInfo[] };
  right: number;
  focus: string | null;
  actions: PanelActions;
  onClose: () => void;
}) {
  const colors = useColors();
  const all = useRuns(runs);
  const connected = useSyncExternalStore(agents.subscribe, agents.getSnapshot);
  const now = Date.now();
  const [entries, idle] = [mergeAgents(connected, all), idleConnections(connected, all)];
  const ended = all.filter((run) => !isWorking(run)).sort((a, b) => b.started - a.started);
  const { source, tasks, working } = usePanelTasks();
  const count = entries.length + ended.length + tasks.length;
  const cardOf = (run: RunView, index: number, entry?: AgentEntry) => (
    <RunCard key={run.id} run={run} {...(entry ? { entry } : {})} now={now} first={index === 0} focused={run.id === focus && count > 1} actions={actions} />
  );
  return (
    <View
      testID="agents-panel"
      style={{
        position: "absolute",
        top: 4,
        // Under the mark's right end; at the screen's right edge when it didn't say (a notification's Show).
        ...(right > 0 ? { left: Math.max(8, right - AGENTS_PANEL.width) } : { right: 8 }),
        width: AGENTS_PANEL.width,
        maxHeight: 560,
        flexDirection: "column",
        padding: AGENTS_PANEL.padding,
        borderRadius: AGENTS_PANEL.radius,
        borderWidth: 1,
        borderColor: colors.menuEdge,
        // Solid, as the menus and the notification center are (D114): the launcher's glass let a window's words read through it, in Dark most.
        backgroundColor: PANEL_GROUND(colors),
        shadow: SHADOW.xl,
      }}
    >
      <KeyCatcher onKey={(key) => key === "Escape" && onClose()} />
      {count === 0 ? (
        <NoAgents />
      ) : (
        <ScrollView style={{ flexShrink: 1 }}>
          {source && <TaskCards tasks={tasks} source={source} focus={count > 1 ? focus : null} />}
          {entries.map((entry, index) =>
            entry.run ? (
              cardOf(entry.run, tasks.length + index, entry)
            ) : (
              <ConnectionRow key={entry.key} entry={entry} first={tasks.length + index === 0} actions={actions} />
            ),
          )}
          {ended.map((run, index) => cardOf(run, tasks.length + entries.length + index))}
        </ScrollView>
      )}
      {idle > 0 && <IdleLine idle={idle} rows={count} />}
      {(entries.length > 0 || working.length > 0 || idle > 0) && (
        <StopAllFooter
          onStopAll={() =>
            stopAll(
              actions,
              source,
              working.map((task) => task.id),
            )
          }
        />
      )}
    </View>
  );
}
