/**
 * Ending an app, and locking the screen: the two things an agent can do that
 * the person can't take back by looking. Force quit therefore asks on
 * screen every time (`ctx.confirm`), whatever the agent was allowed before,
 * and the policy Force Quit Applications uses decides what may be ended
 * (force-quit/policy.ts): never the shell or the session, never a process
 * with no window.
 */

import type { CompositorWindow } from "../../compositor.ts";
import { clean } from "../../notifications/text.ts";
import type { AppGroup } from "../../force-quit/model.ts";
import { type RunContext, text, toolError, type ToolResult } from "../context.ts";
import type { Call } from "../tools/index.ts";

type Target = Extract<Call, { name: "force_quit_app" }>["target"];

/** How the agent is told about an app: by name if it may know it, else by the id it gave. */
function subject(group: AppGroup, target: Target, ctx: RunContext): string {
  if (ctx.mayName()) return `“${clean(group.name, 60)}”`;
  return "window" in target ? `w${target.window}` : `process ${target.pid}`;
}

const windowsOf = (windows: readonly CompositorWindow[], pid: number) => windows.filter((window) => window.pid === pid).length;

/** The process the target stands for, or why there is none. */
function resolve(windows: readonly CompositorWindow[], target: Target): number | ToolResult {
  if (!("window" in target)) return target.pid;
  const window = windows.find((candidate) => candidate.id === target.window);
  if (!window) return toolError(`There is no window w${target.window} now; call list_windows for current ids.`);
  return window.pid ?? toolError(`w${window.id} has no process id to end.`);
}

const REFUSED = (name: string) => `${name} can't be force quit: it is not an app with a window, or it belongs to the shell or the session.`;

export async function forceQuitApp(target: Target, ctx: RunContext): Promise<ToolResult> {
  ctx.status("Looking at a stuck app");
  const { compositor, desktop } = ctx;
  const windows = await compositor.windows();
  const pid = resolve(windows, target);
  if (typeof pid !== "number") return pid;
  const group = desktop.forceQuit.apps(windows).find((candidate) => candidate.pid === pid);
  const label = "window" in target ? `w${target.window}` : `process ${target.pid}`;
  // Nothing to ask about: the shell, the session, and processes without windows are not Force Quit's to end.
  if (!group) return toolError(REFUSED(label));
  const name = subject(group, target, ctx);

  const count = windowsOf(windows, pid);
  const yes = await ctx.confirm({
    summary: `force “${clean(group.name, 60)}” to quit`,
    detail: `${count === 1 ? "Its window closes" : `Its ${count} windows close`} at once, and anything you haven't saved in it is lost.`,
    action: "Force Quit",
  });
  if (!yes) return toolError(`The person did not allow ${name} to be force quit. Don't ask again unless they agree.`);

  // They may have taken a while: look again, and end only what they were shown.
  const after = await compositor.windows();
  const still = desktop.forceQuit.apps(after).find((candidate) => candidate.pid === pid && candidate.appId === group.appId);
  if (!still) return toolError(`${name} changed while the person was deciding, so nothing was ended. Call list_windows and try again.`);
  ctx.status(`Force quitting ${name}`);
  const outcome = desktop.forceQuit.end(pid, after);
  if (outcome.kind === "refused") return toolError(`${name} could not be force quit: ${outcome.reason}.`);
  return text(outcome.kind === "ended" ? `${name} had already ended.` : `${name} was force quit.`);
}

export function lockScreen(ctx: RunContext): ToolResult {
  ctx.status("Locking the screen");
  ctx.desktop.lock();
  return text("The screen is locking. Every tool is refused until the person unlocks it with their password.");
}
