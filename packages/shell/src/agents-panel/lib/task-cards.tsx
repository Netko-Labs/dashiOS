/**
 * An Ask task's card in the agents' panel (../agents-panel.tsx): what was
 * asked, who answers and how it stands, its steps as Dashi words them, what
 * it said when it is done, Stop while it can be stopped, and Undo for each
 * settings change that can be put back. A plan that waits for a yes is not
 * answered here: "Answer" shows it where it is (the card on the Dock, or
 * the launcher).
 */

import { useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { cut, type TaskView } from "../../agents/index.ts";
import { SPARK } from "../../shared/settings/index.ts";
import type { PanelTasks } from "../tasks.tsx";
import { Small } from "./agents-rows.tsx";

/** The panel's focus for a task's card (the bar's `taskFocus`). */
export const taskCardFocus = (id: string): string => `task:${id}`;

/** Tasks the panel shows: at work or waiting first, then the ones that ended, newest first, a few. */
export const ENDED_TASKS = 4;
export const taskWorks = (task: TaskView): boolean => task.phase === "asking" || task.phase === "planned" || task.phase === "running";
export function panelTaskList(tasks: readonly TaskView[]): TaskView[] {
  const ended = tasks.filter((task) => task.phase === "done" || (task.phase === "failed" && task.leftNow !== true)).slice(0, ENDED_TASKS);
  return [...tasks.filter(taskWorks), ...ended];
}

/** The card's second line: who answers, and how it stands. */
export function taskLine(task: TaskView): string {
  const how =
    task.phase === "asking"
      ? "Thinking"
      : task.phase === "planned"
        ? "Waiting for you"
        : task.phase === "running"
          ? `Step ${Math.min(task.steps.length, task.steps.filter((step) => step.state.kind !== "ready").length)} of ${task.steps.length}`
          : task.phase === "done"
            ? "Done"
            : task.phase === "failed"
              ? (task.failure?.text ?? "Didn’t answer")
              : "Stopped";
  return `${task.answerer.name} · ${how}`;
}

function TaskStep({ step }: { step: TaskView["steps"][number] }) {
  const colors = useColors();
  const kind = step.state.kind;
  const mark = kind === "done" ? "✓" : kind === "failed" || kind === "invalid" || kind === "not-allowed" ? "✕" : kind === "skipped" ? "–" : "";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, height: 18 }}>
      <View style={{ width: 12, alignItems: "center" }}>
        {mark === "" ? (
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: kind === "running" ? colors.agent : colors.separator }} />
        ) : (
          <Text style={{ fontSize: 11, color: kind === "done" ? colors.textMuted : colors.criticalInk }}>{mark}</Text>
        )}
      </View>
      <Text numberOfLines={1} style={{ fontSize: 12, color: kind === "running" || kind === "ready" ? colors.text : colors.textMuted }}>
        {step.undone ? `${step.title} (put back)` : step.title}
      </Text>
    </View>
  );
}

export function TaskCard({ task, first, focused, tasks }: { task: TaskView; first: boolean; focused: boolean; tasks: PanelTasks }) {
  const colors = useColors();
  const works = taskWorks(task);
  const undos = task.steps.flatMap((step, index) => (step.undo && !step.undone ? [{ index, undo: step.undo }] : []));
  return (
    <View
      testID={`agents-task:${task.id}`}
      style={{
        flexDirection: "row",
        gap: 10,
        padding: 10,
        borderRadius: 9,
        ...(first ? {} : { borderTopWidth: 1, borderColor: colors.separator }),
        ...(focused ? { backgroundColor: colors.selectionWash } : {}),
        ...(works ? {} : { opacity: 0.8 }),
      }}
    >
      <View style={{ width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: colors.agentWash }}>
        <Svg markup={SPARK} size={15} color={colors.agent} />
      </View>
      <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 2 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
          {cut(task.request, 60)}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 12, color: task.phase === "planned" ? colors.broth : colors.textMuted }}>
          {taskLine(task)}
        </Text>
        {task.steps.map((step) => (
          <TaskStep key={step.id} step={step} />
        ))}
        {task.said !== "" && !works && (
          <View testID={`agents-task-said:${task.id}`} style={{ marginTop: 2 }}>
            <Text style={{ fontSize: 12.5, color: colors.text }}>{task.said}</Text>
          </View>
        )}
        {(works || undos.length > 0) && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {task.phase === "planned" && <Small testID={`agents-task-answer:${task.id}`} label="Answer" primary onPress={() => tasks.answer(task.id)} />}
            {works && <Small testID={`agents-task-stop:${task.id}`} label="Stop" danger onPress={() => tasks.stop(task.id)} />}
            {!works &&
              undos.map(({ index, undo }) => (
                <Small
                  key={index}
                  testID={`agents-task-undo:${task.id}:${index}`}
                  label={`Undo: ${undo.title}`}
                  onPress={() => tasks.undo(task.id, index, undo)}
                />
              ))}
          </View>
        )}
      </View>
    </View>
  );
}
