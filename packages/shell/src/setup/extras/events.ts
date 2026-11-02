/**
 * What `dashi-extras` says (session/dashi-extras), and where each step is.
 * One JSON object per line on its stdout; every line is parsed and checked
 * here, and anything else (a stray line, a step it was not asked for) is
 * dropped. Pure, so the window and its tests agree.
 */

export const EXTRA_STEPS = ["codecs", "nvidia", "gaming", "flathub"] as const;
export type ExtraStep = (typeof EXTRA_STEPS)[number];

export const isExtraStep = (value: unknown): value is ExtraStep => EXTRA_STEPS.some((step) => step === value);

export type FailReason = "offline" | "package" | "other";
const isFailReason = (value: unknown): value is FailReason => value === "offline" || value === "package" || value === "other";

export type ExtrasEvent =
  | { event: "start"; step: ExtraStep }
  | { event: "progress"; step: ExtraStep; message: string; fraction: number | null }
  | { event: "done"; step: ExtraStep; message: string | null }
  | { event: "failed"; step: ExtraStep; reason: FailReason; message: string }
  | { event: "finished"; ok: boolean };

/** Long enough for any sentence the helper says; a longer one is cut. */
const MAX_MESSAGE = 300;
const text = (value: unknown): string | null => (typeof value === "string" ? value.trim().slice(0, MAX_MESSAGE) : null);

/** One line of the helper's output as an event, or null when it is not one. */
export function parseEvent(line: string): ExtrasEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const fields = value as Record<string, unknown>;
  if (fields.event === "finished") return typeof fields.ok === "boolean" ? { event: "finished", ok: fields.ok } : null;
  const { step } = fields;
  if (!isExtraStep(step)) return null;
  switch (fields.event) {
    case "start":
      return { event: "start", step };
    case "progress": {
      const message = text(fields.message);
      if (message === null) return null;
      const { fraction } = fields;
      const known = typeof fraction === "number" && Number.isFinite(fraction);
      return { event: "progress", step, message, fraction: known ? Math.min(1, Math.max(0, fraction)) : null };
    }
    case "done":
      return { event: "done", step, message: text(fields.message) || null };
    case "failed": {
      const message = text(fields.message);
      return isFailReason(fields.reason) ? { event: "failed", step, reason: fields.reason, message: message || "It did not finish." } : null;
    }
    default:
      return null;
  }
}

/** Cuts a stream into lines: `push` gives the lines a chunk completes, `end` whatever is left. */
export class LineSplitter {
  private rest = "";

  push(chunk: string): string[] {
    const lines = (this.rest + chunk).split("\n");
    this.rest = lines.pop() ?? "";
    return lines.filter((line) => line.trim() !== "");
  }

  end(): string[] {
    const last = this.rest;
    this.rest = "";
    return last.trim() === "" ? [] : [last];
  }
}

export type StepState =
  | { status: "waiting" }
  | { status: "running"; message: string | null; fraction: number | null }
  | { status: "done"; message: string | null }
  | { status: "failed"; reason: FailReason; message: string };

export type StepStates = Readonly<Partial<Record<ExtraStep, StepState>>>;

/** Every step asked for, waiting. */
export function waitingStates(steps: readonly ExtraStep[]): StepStates {
  return Object.fromEntries(steps.map((step) => [step, { status: "waiting" }]));
}

/** The states after one event. Events for a step not asked for, or for one already over, change nothing. */
export function applyEvent(states: StepStates, event: ExtrasEvent): StepStates {
  if (event.event === "finished") return states;
  const current = states[event.step];
  if (current === undefined || current.status === "done" || current.status === "failed") return states;
  switch (event.event) {
    case "start":
      return { ...states, [event.step]: { status: "running", message: null, fraction: null } };
    case "progress":
      return { ...states, [event.step]: { status: "running", message: event.message, fraction: event.fraction } };
    case "done":
      return { ...states, [event.step]: { status: "done", message: event.message } };
    case "failed":
      return { ...states, [event.step]: { status: "failed", reason: event.reason, message: event.message } };
  }
}

/** How a run of the helper ended, as the page says it. */
export type RunEnd =
  /** The person dismissed the password sheet: nothing ran. */
  | { kind: "cancelled" }
  /** polkit said no (a wrong password, or not allowed): nothing ran. */
  | { kind: "denied" }
  | { kind: "ran"; states: StepStates };

/** pkexec's statuses when it ran nothing: 126, the dialog was dismissed; 127, not authorized or an error. */
const PKEXEC_DISMISSED = 126;
const PKEXEC_NOT_AUTHORIZED = 127;

/**
 * The run's end from the helper's exit status and the states its events
 * left. A step it never finished (it crashed, or was killed) is failed
 * here, so no step is left spinning.
 */
export function endOfRun(states: StepStates, code: number | null, sawEvents: boolean): RunEnd {
  if (!sawEvents && code === PKEXEC_DISMISSED) return { kind: "cancelled" };
  if (!sawEvents && code === PKEXEC_NOT_AUTHORIZED) return { kind: "denied" };
  const settled = Object.fromEntries(
    Object.entries(states).map(([step, state]) =>
      state.status === "waiting" || state.status === "running"
        ? [step, { status: "failed", reason: "other", message: sawEvents ? "The installer stopped before it finished." : "The installer could not start." }]
        : [step, state],
    ),
  );
  return { kind: "ran", states: settled };
}

/** Whether every failed step failed for want of a network (and at least one did). */
export function isOffline(states: StepStates): boolean {
  const failed = Object.values(states).filter((state) => state.status === "failed");
  return failed.length > 0 && failed.every((state) => state.status === "failed" && state.reason === "offline");
}

/** The steps that failed, in the order given. */
export function failedSteps(steps: readonly ExtraStep[], states: StepStates): ExtraStep[] {
  return steps.filter((step) => states[step]?.status === "failed");
}
