/**
 * The plan in the launcher (docs/betterments.html, "A plan before acting",
 * recommendation B): under one head ("Claude will"), the steps in Dashi's
 * words, numbered, each with its scope chip (shiso: agentWash with agentInk
 * text, 20 tall, CO-3). One Return runs them; then each number turns into a
 * running mark, then a check in moss, or "Not allowed" in broth with "Allow
 * once" right there, or what went wrong. A settings change keeps its Undo.
 *
 * The rows are the launcher's (40 tall, radius 7, the kombu wash and bar
 * when selected: selecting is the person's, CO-6); the panel never grows past
 * its surface, and a long plan is cut at MAX_STEPS (agents/ask/plan.ts).
 */

import { CHECK, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { type Step, signInCommand, type TaskView } from "../../agents/index.ts";
import { ROW_HEIGHT, SectionHead } from "../row-view.tsx";

export const STEP = { number: 20, chip: 20, chipText: 11 } as const;

/** A step running: an open ring, drawn still (no timer re-renders, MO-3). */
const RUNNING = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 2.5a5.5 5.5 0 1 1-5.5 5.5" stroke="#000" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`;

/** What pressing (or Return on) a step does, if anything. */
export type StepAct = "allow-once" | "undo" | null;

export function stepAct(step: Step): StepAct {
  if (step.state.kind === "not-allowed") return "allow-once";
  if (step.state.kind === "done" && step.undo && !step.undone) return "undo";
  return null;
}

/** A failure that Settings fixes (a key, a model, a harness to install), not trying again. */
export const needsSettings = (failure: TaskView["failure"]): boolean =>
  failure?.kind === "no-key" || failure?.kind === "no-model" || failure?.kind === "not-installed";

/** A harness that isn't signed in: its sign-in runs in Terminal. */
export const needsSignIn = (failure: TaskView["failure"]): boolean => failure?.kind === "not-signed-in";

/** The word for Return at the field's end, on a failure. */
export const failureKey = (failure: TaskView["failure"]): string => (needsSignIn(failure) ? "Terminal" : needsSettings(failure) ? "Settings" : "Retry");

/**
 * Why no plan came, and what Return does about it: "Claude Code isn't
 * signed in. Return opens Terminal to sign in with claude auth login."
 * (`signIn`: the harness's own sign-in command, typed there.)
 */
export function failureLine(failure: NonNullable<TaskView["failure"]>, signIn: string | null = null): string {
  if (needsSignIn(failure)) return `${failure.text} Return opens Terminal to sign in${signIn ? ` with ${signIn}` : ""}.`;
  return `${failure.text} ${needsSettings(failure) ? "Return opens Settings." : "Return tries again."}`;
}

/** The head over the steps. */
export function planHead(task: TaskView): string {
  switch (task.phase) {
    case "asking":
      return `Asking ${task.answerer.name}…`;
    case "failed":
      return `${task.answerer.name} didn't answer`;
    default:
      return task.steps.length > 0 ? `${task.answerer.name} will` : task.answerer.name;
  }
}

/** The words a step's right end says, and in which ink. */
export function stepEnd(step: Step): { text: string; tone: "chip" | "moss" | "broth" | "critical" | "muted" } {
  switch (step.state.kind) {
    case "ready":
    case "running":
      return { text: step.scope ? `${step.scope} · ${step.asks ? "will ask" : "allowed"}` : step.asks ? "will ask" : "allowed", tone: "chip" };
    case "done":
      return step.undone ? { text: "Undone", tone: "muted" } : step.undo ? { text: "Undo", tone: "moss" } : { text: "Done", tone: "moss" };
    case "not-allowed":
      return { text: "Not allowed · Allow once", tone: "broth" };
    case "failed":
      return { text: step.state.error, tone: "critical" };
    case "invalid":
      return { text: "Can't run", tone: "muted" };
    case "skipped":
      return { text: "Stopped", tone: "muted" };
  }
}

function Mark({ step, index, ink }: { step: Step; index: number; ink: string }) {
  const colors = useColors();
  const box = { width: STEP.number, height: STEP.number, alignItems: "center", justifyContent: "center" } as const;
  if (step.state.kind === "running")
    return (
      <View style={box}>
        <Svg markup={RUNNING} size={14} color={colors.textMuted} />
      </View>
    );
  if (step.state.kind === "done")
    return (
      <View style={box}>
        <Svg markup={CHECK} size={14} color={colors.moss} />
      </View>
    );
  return (
    <View style={box}>
      <Text style={{ fontSize: 13, color: ink }}>{String(index + 1)}</Text>
    </View>
  );
}

function StepRow({ step, index, selected, onPress, onHover }: { step: Step; index: number; selected: boolean; onPress: () => void; onHover: () => void }) {
  const colors = useColors();
  const ink = selected ? colors.onSelection : colors.text;
  const end = stepEnd(step);
  const detail = step.state.kind === "invalid" ? step.state.error : undefined;
  const toneInk = { chip: colors.agentInk, moss: colors.moss, broth: colors.broth, critical: colors.criticalInk, muted: colors.textMuted }[end.tone];
  return (
    <View
      testID={`launcher:step:${index}`}
      onPress={onPress}
      onHoverChange={(hovered) => {
        if (hovered) onHover();
      }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        height: ROW_HEIGHT,
        paddingLeft: 10,
        paddingRight: 12,
        borderRadius: 7,
        ...(selected ? { backgroundColor: colors.selectionWash } : {}),
      }}
    >
      {selected && (
        <View
          style={{ position: "absolute", left: 0, top: (ROW_HEIGHT - 20) / 2, width: 3, height: 20, borderRadius: 1.5, backgroundColor: colors.selectionBar }}
        />
      )}
      <Mark step={step} index={index} ink={selected ? colors.onSelection : colors.textMuted} />
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flexShrink: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, color: ink }}>
            {step.title}
          </Text>
        </View>
        {detail !== undefined && (
          <View style={{ flexShrink: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 12, color: selected ? colors.onSelection : colors.textMuted }}>
              {detail}
            </Text>
          </View>
        )}
      </View>
      {end.tone === "chip" ? (
        <View
          testID={`launcher:chip:${index}`}
          style={{
            flexShrink: 0,
            height: STEP.chip,
            paddingLeft: 8,
            paddingRight: 8,
            borderRadius: STEP.chip / 2,
            justifyContent: "center",
            backgroundColor: colors.agentWash,
          }}
        >
          <Text numberOfLines={1} style={{ fontSize: STEP.chipText, color: colors.agentInk }}>
            {end.text}
          </Text>
        </View>
      ) : (
        <View testID={`launcher:step-end:${index}`} style={{ flexShrink: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 12, color: selected ? colors.onSelection : toneInk }}>
            {end.text}
          </Text>
        </View>
      )}
    </View>
  );
}

/** A line of words that is not a step: what the model said, or why nothing came. Not selectable. */
function Words({ testID, text, tone }: { testID: string; text: string; tone: "muted" | "critical" }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ height: ROW_HEIGHT, flexDirection: "row", alignItems: "center", paddingLeft: 12, paddingRight: 12 }}>
      <Text numberOfLines={1} style={{ fontSize: 12, color: tone === "critical" ? colors.criticalInk : colors.textMuted }}>
        {text}
      </Text>
    </View>
  );
}

export interface PlanListProps {
  task: TaskView;
  /** The step selected (↑ ↓, the pointer), or null. */
  selected: number | null;
  onStep(index: number): void;
  onHover(index: number): void;
}

export function PlanList({ task, selected, onStep, onHover }: PlanListProps) {
  return (
    <View testID="launcher:section:plan" style={{ flexDirection: "column" }}>
      <SectionHead title={planHead(task)} />
      {task.phase === "failed" && task.failure && (
        <Words testID="launcher:plan-failure" text={failureLine(task.failure, signInCommand(task.answerer.id))} tone="critical" />
      )}
      {task.said !== "" && <Words testID="launcher:plan-said" text={`${task.answerer.name}: ${task.said}`} tone="muted" />}
      {task.steps.map((step, index) => (
        <StepRow key={step.id} step={step} index={index} selected={selected === index} onPress={() => onStep(index)} onHover={() => onHover(index)} />
      ))}
    </View>
  );
}
