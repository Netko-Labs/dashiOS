/** What the Installing page says about each step, each app, and the run. Pure. */

import { failedSteps, isOffline, type StepState } from "./events.ts";
import { type AppStatus, canRetry, type ExtrasRun, isRunOk } from "./store.ts";

export const OFFLINE_NOTICE = "Connect to the internet to install these, or skip and install them later from Software.";

/** A step's status, in a few words (its progress bar, if any, is drawn beside it). */
export function stepLine(state: StepState | undefined): string {
  switch (state?.status) {
    case undefined:
    case "waiting":
      return "Waiting";
    case "running":
      return state.message ?? "Starting…";
    case "done":
      return state.message ?? "Installed";
    case "failed":
      return state.reason === "offline" ? "Not connected to the internet" : state.message;
  }
}

export function appLine(state: AppStatus): string {
  switch (state.status) {
    case "waiting":
      return "Waiting";
    case "installing": {
      const fraction = state.progress?.fraction;
      return fraction === null || fraction === undefined ? "Installing…" : `Installing, ${Math.round(fraction * 100)}%`;
    }
    case "done":
      return state.message ?? "Installed";
    case "failed":
      return state.message;
    case "skipped":
      return "Not installed";
  }
}

export interface Notice {
  message: string;
  /** The button under it: Try Again runs it all again, Retry what failed. */
  action: "try-again" | "retry" | null;
}

/** The line under the lists, once there is something to say. */
export function runNotice(run: ExtrasRun): Notice | null {
  switch (run.phase) {
    case "idle":
    case "running":
      return null;
    case "cancelled":
      return { message: "Nothing was installed, because the password was not entered.", action: "try-again" };
    case "denied":
      return { message: "Dashi was not allowed to install software. Nothing was changed.", action: "try-again" };
    case "finished":
      break;
  }
  if (isRunOk(run)) return { message: "Everything is installed.", action: null };
  if (isOffline(run.states)) return { message: OFFLINE_NOTICE, action: "try-again" };
  const some = failedSteps(run.steps, run.states).length > 0 || run.apps.some((row) => row.state.status === "failed");
  return {
    message: some ? "Some of it could not be installed. Try again, or skip and install it later from Software." : "Everything is installed.",
    action: canRetry(run) ? "retry" : null,
  };
}

/** The primary button's label on the Installing page. */
export const installingContinueLabel = (run: ExtrasRun): string =>
  (run.phase === "finished" && isRunOk(run)) || run.phase === "running" ? "Continue" : "Skip";

/** The Done page's line for the run, or null when nothing was started. */
export function runSummary(run: ExtrasRun): string | null {
  switch (run.phase) {
    case "idle":
      return null;
    case "running":
      return "Installing…";
    case "cancelled":
    case "denied":
      return "Not installed";
    case "finished":
      return isRunOk(run) ? "Installed" : "Some not installed";
  }
}
