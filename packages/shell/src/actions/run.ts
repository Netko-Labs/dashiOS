/**
 * Carrying an action out for the person: from the launcher, a key, or a
 * `dashi://` link. Whatever asked, it runs as the person and is written in
 * the agents' activity log as "you" (agents/consent.ts), beside what agents
 * did. An action that asks agents every time (force quitting, the Trash)
 * asks the person too, on a sheet of its own: the tool asks, and the
 * person's sheet answers (agents/server.ts `runAsPerson`).
 *
 * A link comes from outside: a note, a web page, a script. It never runs an
 * action that is destructive. It opens it instead, with its arguments filled
 * in: the launcher shows it ready for Return when one is there to take it
 * (`present`), otherwise a sheet asks. A settings address with no arguments
 * opens Settings at the row.
 */

import { mayUse } from "./registry.ts";
import type { ActionContext, ActionDef, Args, Outcome } from "./types.ts";
import { failed } from "./types.ts";

/** Who asked: the person themselves (the launcher, a key), or a link from outside. */
export type Origin = "person" | "link";

export interface RunDeps {
  /** What carrying it out reaches (the focused window, the tools as the person). */
  context(window: number | null): ActionContext;
  /** One line in the activity log, as "you". */
  log(entry: { tool: string; outcome: string }): void;
  /** Open System Settings at a pane, scrolled to a row and lighting it up. */
  reveal(place: { pane: string; row?: string }): void;
  /** The launcher shows the action with its arguments filled in, ready for Return; false when nothing took it. */
  present?(action: ActionDef, args: Args): boolean;
  /** Ask the person, on a sheet, about an action a link asked for; true only if they go ahead. */
  confirmLink(action: ActionDef, args: Args): Promise<boolean>;
}

/** What a link to `action` does: open its place, open it for the person to finish, or run it. */
export function linkDecision(action: ActionDef, args: Args): "reveal" | "present" | "run" {
  if (action.place && Object.keys(args).length === 0) return "reveal";
  // Its own sheet asks anyway (force quit, restart): the sheet is the opening.
  if (action.destructive && !action.asksEveryTime) return "present";
  return "run";
}

/** Run `action` with `args` for the person; `window` is the one focused when they asked. */
export async function runAction(action: ActionDef, args: Args, origin: Origin, deps: RunDeps, window: number | null = null): Promise<Outcome> {
  const tool = action.address;
  if (!mayUse(action, "person")) return failed("Only agents use this.");
  if (origin === "link") {
    const decision = linkDecision(action, args);
    if (decision === "reveal" && action.place) {
      deps.reveal(action.place);
      deps.log({ tool, outcome: "opened" });
      return { ok: true, text: `${action.title} is open in System Settings.` };
    }
    if (decision === "present") {
      // Checked first: a link with arguments that don't fit says so, and runs nothing.
      const checked = action.check(args);
      if (!checked.ok) return failed(checked.error);
      if (deps.present?.(action, args)) {
        deps.log({ tool, outcome: "opened" });
        return { ok: true, text: `${action.title} is open, waiting for you.` };
      }
      if (!(await deps.confirmLink(action, args))) {
        deps.log({ tool, outcome: "cancelled" });
        return failed("Cancelled.");
      }
      return finish(action, checked.run, deps, window);
    }
  }
  const checked = action.check(args);
  if (!checked.ok) return failed(checked.error);
  return finish(action, checked.run, deps, window);
}

async function finish(action: ActionDef, run: (ctx: ActionContext) => Promise<Outcome>, deps: RunDeps, window: number | null): Promise<Outcome> {
  let outcome: Outcome;
  try {
    outcome = await run(deps.context(window));
  } catch (error) {
    outcome = failed(`${action.title} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  deps.log({ tool: action.address, outcome: outcome.ok ? "ok" : outcome.error === "Cancelled." ? "cancelled" : "error" });
  return outcome;
}
