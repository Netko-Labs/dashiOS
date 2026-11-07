/**
 * Agents started from the launcher, put together (docs/actions.md, "Agents
 * from the launcher"; main.tsx starts it): which harnesses are installed and
 * which comes first (Settings › Agents, "Hand off to"), the grants card's
 * memory, starting a run and each follow-up as a user service (runner.ts),
 * reading its stream into the store (store.ts), Stop, Undo, and the policy
 * the agents server applies to a run's MCP connection.
 */

import { join } from "node:path";
import { ANSWERERS, HARNESS_IDS, type HarnessId } from "../ask/answerer.ts";
import { type Files, findHarness, HARNESSES, harnessEnv, hostFiles, type Probe, type ShellPaths, shellPaths, signedIn } from "../ask/harness/index.ts";
import { settingWords, type Undo } from "../ask/plan.ts";
import type { Scope } from "../consent.ts";
import type { Call } from "../tools/index.ts";
import { TASK_PROMPT, taskCommand } from "./commands.ts";
import { followUpPrompt, followUpRoute } from "./follow-up.ts";
import { contextPrompt, GrantsMemory, grantsKind, TASK_GRANTED, TASK_REFUSED, type TaskContext, taskGrants } from "./grants.ts";
import { harnessOrder } from "./order.ts";
import { systemdRunner, type TaskRunner } from "./runner.ts";
import { AgentRuns, type RunView } from "./store.ts";
import { eventsOf } from "./stream.ts";

/** What settings.json's `agents` says about handing off. */
export interface HandoffSettings {
  getSnapshot(): { data: { agents: { handOff?: HarnessId; answerer?: string; skipGrants?: boolean } } };
  subscribe(listener: () => void): () => void;
}

/** A harness on its "Hand it off" row. */
export interface HandoffHarness {
  id: HarnessId;
  name: string;
  /** "your ChatGPT plan". */
  uses: string;
  /** null: can't tell cheaply. */
  signedIn: boolean | null;
}

/** What the agents server applies to a run's MCP connection (session.ts). */
export interface TaskPolicy {
  granted: readonly Scope[];
  refused: readonly Scope[];
  /** The window the context chip named: it may hand that one to the person. */
  window: number | null;
}

export interface StartTask {
  harness: HarnessId;
  request: string;
  context: TaskContext;
}

export interface HandoffOptions {
  settings: HandoffSettings;
  env: Readonly<Record<string, string | undefined>>;
  runner?: TaskRunner;
  files?: Files;
  probe?: Probe;
  shell?: ShellPaths & { task: string };
  memory?: GrantsMemory;
  /** A tool's title from Dashi's catalog ("Change a setting"). */
  titleOf?(tool: string): string | undefined;
  /** A setting's value now, by its agents' name (for Undo). */
  settingNow?(name: string): unknown;
  /** The set_setting action's address, for Undo. */
  setSettingAddress?(): string | null;
  runAsPerson?(address: string, args: Record<string, unknown>): Promise<{ ok: boolean }>;
  /** A run ended: the notification (main.tsx). */
  ended?(run: RunView): void;
  /** For tests: the clock and the ids. */
  now?: () => number;
  newId?: () => string;
}

export interface Handoff {
  runs: AgentRuns;
  /** The installed harnesses, the one to hand off to first. */
  harnesses(): readonly HandoffHarness[];
  /** Look again for harnesses (the launcher opened), and whether they're signed in. */
  refresh(): void;
  subscribeHarnesses(listener: () => void): () => void;
  /** Whether the grants card shows before a task with this context starts. */
  needsCard(context: TaskContext): boolean;
  /** Start a task; its run's id, or null when nothing could start. */
  start(input: StartTask): Promise<string | null>;
  /** Send words to a run (⇥ on its row, Follow up): false when there's no such run. */
  tell(run: string, text: string): boolean;
  stop(run: string): void;
  undo(run: string, index: number): Promise<boolean>;
  /** The policy for a connection from run `task`'s sandbox; null for a run Dashi doesn't know. */
  policy(task: string): TaskPolicy | null;
  /** Before a run's tool call: what would put it back (a settings change). */
  before(task: string, call: Call): Undo | null;
  /** After it: kept when it went well. */
  after(task: string, undo: Undo | null, ok: boolean): void;
  close(): void;
}

/** A run's id: letters and digits only, as its scope's name needs (sandbox.ts `taskOfCgroup`). */
const randomId = (): string => crypto.randomUUID().replace(/-/g, "").slice(0, 10);

/** The harnesses' words for their rows: "your ChatGPT plan". */
const usesWords = (id: HarnessId): string => HARNESSES[id].uses.charAt(0).toLowerCase() + HARNESSES[id].uses.slice(1);

export function startHandoff(options: HandoffOptions): Handoff {
  const env = options.env;
  const home = env.HOME ?? "";
  const runtime = env.XDG_RUNTIME_DIR ?? "";
  const files = options.files ?? hostFiles;
  const shell = options.shell ?? { ...shellPaths(), task: join(import.meta.dir, "../../../bin/dashi-task.ts") };
  const runner = options.runner ?? systemdRunner({ runtime, bun: shell.bun, task: shell.task });
  const memory = options.memory ?? new GrantsMemory();
  const runs = new AgentRuns({ ...(options.now ? { now: options.now } : {}), titleOf: (tool) => options.titleOf?.(tool) });
  const policies = new Map<string, TaskPolicy>();
  /** The turn being read for each run, and how to stop reading it. */
  const watching = new Map<string, { turn: number; off: () => void }>();
  /** Words waiting for a run that has no session yet, or for its turn to end before it resumes. */
  const waitingWords = new Map<string, string[]>();
  const harnessListeners = new Set<() => void>();
  let signed = new Map<HarnessId, boolean | null>();
  let found: HandoffHarness[] = [];

  const lookForHarnesses = () => {
    const installed = home ? HARNESS_IDS.filter((id) => findHarness(HARNESSES[id], home, env.PATH, files) !== null) : [];
    const agents = options.settings.getSnapshot().data.agents;
    found = harnessOrder(installed, agents.handOff, agents.answerer).map((id) => ({
      id,
      name: ANSWERERS[id].name,
      uses: usesWords(id),
      signedIn: signed.get(id) ?? null,
    }));
    for (const listener of harnessListeners) listener();
  };
  lookForHarnesses();
  const offSettings = options.settings.subscribe(lookForHarnesses);

  /** Read turn `turn` of `run` into the store. */
  const watch = (run: string, harness: HarnessId, turn: number) => {
    watching.get(run)?.off();
    const off = runner.watch(
      run,
      turn,
      (line) => {
        for (const event of eventsOf(harness, line)) runs.event(run, event);
        // Words that waited for its session go now.
        if (runs.get(run)?.session && waitingWords.has(run) && watching.get(run)?.turn === turn) flushWords(run);
      },
      (code) => {
        if (watching.get(run)?.turn !== turn) return;
        watching.delete(run);
        if (waitingWords.has(run)) return void resume(run, true);
        runs.exited(run, code);
      },
    );
    watching.set(run, { turn, off });
  };

  /** Start turn `turn` of a run with this prompt, resuming `session` if there is one. */
  const startTurn = async (run: string, harness: HarnessId, turn: number, prompt: string, session: string | null): Promise<boolean> => {
    const spec = HARNESSES[harness];
    const where = home ? findHarness(spec, home, env.PATH, files) : null;
    if (!where || !runtime) {
      runs.event(run, { kind: "failed", error: `${ANSWERERS[harness].name} isn't installed.` });
      return false;
    }
    const command = taskCommand(harness, { prompt, system: TASK_PROMPT, session, mcp: { command: shell.bun, args: [shell.bridge], env: {} } });
    const profile = {
      socket: join(runtime, "dashi-mcp.sock"),
      readOnly: [...where.readOnly, ...[shell.bun, shell.bridge].filter((path) => path.startsWith(`${home}/`))],
      state: spec.state(home, env),
      cwd: join(runtime, "dashi-task"),
      task: true,
    };
    const error = await runner.start({
      run,
      turn,
      argv: [shell.bun, shell.dashiAgent, "--name", `task-${run}`, "--", where.program, ...command.args],
      stdin: command.stdin,
      env: harnessEnv(spec, env, { ...command.env, DASHI_AGENT_PLAN: JSON.stringify(profile) }),
    });
    if (error) {
      runs.event(run, { kind: "failed", error });
      return false;
    }
    watch(run, harness, turn);
    return true;
  };

  /** The words waiting for `run` go into its session: stopped where it is first if it still works. */
  const flushWords = (run: string) => {
    const view = runs.get(run);
    if (!view) return;
    const route = followUpRoute(view, "");
    if (route.kind === "restart") {
      // It stops, and the words go once its turn has ended (watch's exit).
      runner.stop(run, view.turn);
      return;
    }
    if (route.kind !== "wait") void resume(run, false);
  };

  /** Its next turn, with the words that waited. */
  const resume = async (run: string, interrupted: boolean) => {
    const words = waitingWords.get(run) ?? [];
    waitingWords.delete(run);
    const before = runs.get(run);
    if (!before || words.length === 0) return;
    const text = words.join("\n\n");
    const route = followUpRoute({ ...before, phase: "done" }, text);
    const view = runs.followUp(run, text);
    if (!view) return;
    const prompt = route.kind === "start-over" ? route.prompt : followUpPrompt(text, interrupted);
    await startTurn(run, view.harness, view.turn, prompt, route.kind === "resume" ? route.session : null);
  };

  // Ended runs: their notification once; runs over an hour old: their files.
  const told = new Set<string>();
  const offRuns = runs.subscribe(() => {
    for (const run of runs.getSnapshot()) {
      const key = `${run.id}:${run.turn}`;
      if (run.ended === null || told.has(key)) continue;
      told.add(key);
      options.ended?.(run);
    }
  });
  const pruner = setInterval(() => {
    for (const run of runs.prune()) {
      runner.forget(run);
      policies.delete(run);
    }
  }, 60_000);

  const settingAddress = () => options.setSettingAddress?.() ?? null;

  return {
    runs,
    harnesses: () => found,
    refresh() {
      lookForHarnesses();
      void Promise.all(
        found.map(async (harness) => {
          const where = findHarness(HARNESSES[harness.id], home, env.PATH, files);
          const yes = where ? await signedIn(HARNESSES[harness.id], where, home, env, options.probe).catch(() => null) : null;
          return [harness.id, yes] as const;
        }),
      ).then((answers) => {
        signed = new Map(answers);
        lookForHarnesses();
      });
    },
    subscribeHarnesses(listener) {
      harnessListeners.add(listener);
      return () => harnessListeners.delete(listener);
    },
    needsCard: (context) => memory.needsCard(grantsKind(taskGrants(context)), options.settings.getSnapshot().data.agents.skipGrants === true),
    async start({ harness, request, context }) {
      const id = options.newId?.() ?? randomId();
      memory.remember(grantsKind(taskGrants(context)));
      policies.set(id, { granted: TASK_GRANTED, refused: TASK_REFUSED, window: context.window?.id ?? null });
      runs.start({ id, request, harness, harnessName: ANSWERERS[harness].name });
      const prompt = [request, contextPrompt(context)].filter(Boolean).join("\n\n");
      await startTurn(id, harness, 1, prompt, null);
      return id;
    },
    tell(run, text) {
      const view = runs.get(run);
      const words = text.trim();
      if (!view || !words) return false;
      waitingWords.set(run, [...(waitingWords.get(run) ?? []), words]);
      const route = followUpRoute(view, words);
      if (route.kind === "restart") runner.stop(run, view.turn);
      else if (route.kind !== "wait") void resume(run, false);
      return true;
    },
    stop(run) {
      const view = runs.get(run);
      if (!view) return;
      waitingWords.delete(run);
      runs.stopping(run);
      runner.stop(run, view.turn);
    },
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
      const address = settingAddress();
      const was = options.settingNow?.(call.setting);
      if (!address || was === undefined || was === null || was === call.value) return null;
      return { address, args: { name: call.setting, value: was as string | number | boolean }, title: settingWords(call.setting, was) };
    },
    after(task, undo, ok) {
      if (undo && ok) runs.changed(task, undo);
    },
    close() {
      offSettings();
      offRuns();
      clearInterval(pruner);
      for (const { off } of watching.values()) off();
      watching.clear();
    },
  };
}
