/**
 * Agents started from the launcher, put together (docs/actions.md, "Agents
 * from the launcher"; main.tsx starts it): which harnesses are installed and
 * which comes first (harness-list.ts), the grants card's memory, starting a
 * run and each follow-up as a user service (turns.ts), the quiet turn's
 * question (quiet-watch.ts), what is kept of the runs (keeper.ts), Stop,
 * Undo, and the policy the agents server applies to a run's MCP connection.
 */

import { join } from "node:path";
import { ANSWERERS, hostFiles, settingWords, shellPaths } from "../ask/index.ts";
import { contextPrompt, GrantsMemory, grantsKind, TASK_GRANTED, TASK_REFUSED, taskGrants } from "./grants.ts";
import { HarnessList } from "./lib/harness-list.ts";
import { RunKeeper } from "./lib/keeper.ts";
import { QuietWatch } from "./lib/quiet-watch.ts";
import { systemdRunner } from "./lib/runner.ts";
import { Turns } from "./lib/turns.ts";
import { AgentRuns } from "./store.ts";
import type { Handoff, HandoffDeps, HandoffOptions } from "./types.ts";

/** A run's id: letters and digits only, as its scope's name needs (sandbox.ts `taskOfCgroup`). */
const randomId = (): string => crypto.randomUUID().replace(/-/g, "").slice(0, 10);

export function startHandoff(options: HandoffOptions): Handoff {
  const env = options.env;
  const home = env.HOME ?? "";
  const runtime = env.XDG_RUNTIME_DIR ?? "";
  const shell = options.shell ?? { ...shellPaths(), task: join(import.meta.dir, "../../../bin/dashi-task.ts") };
  const deps: HandoffDeps = {
    options,
    env,
    home,
    runtime,
    files: options.files ?? hostFiles,
    shell,
    runner: options.runner ?? systemdRunner({ runtime, bun: shell.bun, task: shell.task }),
    runs: new AgentRuns({ ...(options.now ? { now: options.now } : {}), titleOf: (tool) => options.titleOf?.(tool) }),
    policies: new Map(),
  };
  const { runs, policies } = deps;
  const memory = options.memory ?? new GrantsMemory();
  const harnesses = new HarnessList(deps);
  const keeper = new RunKeeper(deps);
  const quiet = new QuietWatch(deps, (run) => turns.stop(run));
  const turns = new Turns(deps, keeper, quiet);
  keeper.pickUp((run, harness, turn) => turns.watch(run, harness, turn));

  return {
    runs,
    harnesses: () => harnesses.harnesses(),
    refresh: () => harnesses.refresh(),
    subscribeHarnesses: (listener) => harnesses.subscribe(listener),
    needsCard: (context) => memory.needsCard(grantsKind(taskGrants(context)), options.settings.getSnapshot().data.agents.skipGrants === true),
    async start({ harness, request, context }) {
      const id = options.newId?.() ?? randomId();
      memory.remember(grantsKind(taskGrants(context)));
      policies.set(id, { granted: TASK_GRANTED, refused: TASK_REFUSED, window: context.window?.id ?? null, name: ANSWERERS[harness].name, sites: new Set() });
      runs.start({ id, request, harness, harnessName: ANSWERERS[harness].name });
      const prompt = [request, contextPrompt(context)].filter(Boolean).join("\n\n");
      await turns.start(id, harness, 1, prompt, null);
      return id;
    },
    tell: (run, text) => turns.tell(run, text),
    stop: (run) => turns.stop(run),
    async undo(run, index) {
      const entry = runs.get(run)?.undos[index];
      if (!entry || entry.undone || !options.runAsPerson) return false;
      const outcome = await options.runAsPerson(entry.undo.address, entry.undo.args);
      if (outcome.ok) runs.undone(run, index);
      return outcome.ok;
    },
    policy: (task) => policies.get(task) ?? null,
    before(task, call) {
      if (!policies.has(task) || call.name !== "set_setting") return null;
      const address = options.setSettingAddress?.() ?? null;
      const was = options.settingNow?.(call.setting);
      // Only a plain value can be put back by set_setting.
      if (!address || (typeof was !== "string" && typeof was !== "number" && typeof was !== "boolean") || was === call.value) return null;
      return { address, args: { name: call.setting, value: was }, title: settingWords(call.setting, was) };
    },
    after(task, undo, ok) {
      if (undo && ok) runs.changed(task, undo);
    },
    close() {
      keeper.close();
      harnesses.close();
      quiet.close();
      turns.close();
    },
  };
}
