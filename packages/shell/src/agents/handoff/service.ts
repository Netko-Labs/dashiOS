/**
 * Agents started from the launcher, put together (docs/actions.md, "Agents
 * from the launcher"; main.tsx starts it): which harnesses are installed and
 * which comes first (Settings › Agents, "Hand off to"), the grants card's
 * memory, starting a run and each follow-up as a user service (runner.ts),
 * reading its stream into the store (store.ts), Stop, Undo, and the policy
 * the agents server applies to a run's MCP connection. Each run's record is
 * kept on disk (records.ts), so a shell that starts picks up the runs still
 * working and those ended in the last hour (`pickUp`).
 */

import { join } from "node:path";
import { ANSWERERS, HARNESS_IDS, type HarnessId } from "../ask/answerer.ts";
import { signInCommand } from "../ask/harness/catalog.ts";
import { type Files, findHarness, HARNESSES, harnessEnv, hostFiles, type Probe, type ShellPaths, shellPaths, signedIn } from "../ask/harness/index.ts";
import { settingWords, type Undo } from "../ask/plan.ts";
import type { Scope } from "../consent.ts";
import { taskSocket } from "../sandbox.ts";
import type { Call } from "../tools/index.ts";
import { TASK_PROMPT, taskCommand } from "./commands.ts";
import { followUpPrompt, followUpRoute } from "./follow-up.ts";
import { contextPrompt, GrantsMemory, grantsKind, TASK_GRANTED, TASK_REFUSED, type TaskContext, taskGrants } from "./grants.ts";
import { harnessOrder } from "./order.ts";
import { replayRun, runsToPickUp } from "./pickup.ts";
import { plainFailure, QUIET_MS, quietQuestion, quietReason } from "./quiet.ts";
import { recordOf } from "./records.ts";
import { streamOf, systemdRunner, type TaskRunner, unitOf } from "./runner.ts";
import { AgentRuns, isWorking, type RunView } from "./store.ts";
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
  /** The harness's name ("Codex"), for sheets and the activity. */
  name: string;
  /** The sites allowed for this task, through all its turns (agents/sites.ts fills it). */
  sites: Set<string>;
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
  /** Sign a harness in (Terminal); a run stuck signed out offers it. */
  signIn?(harness: HarnessId): void;
  /** How long a turn may print nothing before its card asks (quiet.ts `QUIET_MS`). */
  quietMs?: number;
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
        const events = eventsOf(harness, line);
        if (events.length > 0) heard(run);
        const name = ANSWERERS[harness].name;
        for (const event of events) runs.event(run, event.kind === "failed" ? { ...event, error: plainFailure(name, event.error) } : event);
        // Words that waited for its session go now.
        if (runs.get(run)?.session && waitingWords.has(run) && watching.get(run)?.turn === turn) flushWords(run);
      },
      (code) => {
        if (watching.get(run)?.turn !== turn) return;
        watching.delete(run);
        heard(run);
        if (waitingWords.has(run)) return void resume(run, true);
        // Ended badly without a word on its stream: what it wrote to its errors, in plain words when they are known ones.
        const errors = code !== 0 && runs.get(run)?.error === null ? (runner.readErrors?.(run, turn) ?? "") : "";
        const plain = errors ? plainFailure(ANSWERERS[harness].name, errors) : "";
        if (plain && plain !== errors && !runs.get(run)?.ended) runs.event(run, { kind: "failed", error: plain });
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
    // The bridge connects again when the shell restarts (bin/dashi-mcp.ts), through the socket folder the sandbox binds.
    const command = taskCommand(harness, { prompt, system: TASK_PROMPT, session, mcp: { command: shell.bun, args: [shell.bridge, "--reconnect"], env: {} } });
    const profile = {
      socket: taskSocket(runtime),
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
    onDisk.add(run);
    saveRecords();
    watch(run, harness, turn);
    waitQuiet(run, harness, turn);
    return true;
  };

  /** Each run's turn waiting for its first event, and the timer that asks once it has waited too long. */
  const silent = new Map<string, ReturnType<typeof setTimeout>>();
  /** It printed something (or ended): no question about its silence. */
  const heard = (run: string) => {
    clearTimeout(silent.get(run));
    silent.delete(run);
  };
  /** After `quietMs` with nothing from turn `turn`, its card says what's likely wrong: sign in, keep waiting, or stop. */
  const waitQuiet = (run: string, harness: HarnessId, turn: number) => {
    heard(run);
    const timer = setTimeout(() => {
      silent.delete(run);
      void askQuiet(run, harness, turn);
    }, options.quietMs ?? QUIET_MS);
    silent.set(run, timer);
  };
  const askQuiet = async (run: string, harness: HarnessId, turn: number) => {
    const still = () => {
      const view = runs.get(run);
      return view !== undefined && view.turn === turn && isWorking(view) && view.question === null;
    };
    if (!still()) return;
    const spec = HARNESSES[harness];
    const where = home ? findHarness(spec, home, env.PATH, files) : null;
    const signed = where ? await signedIn(spec, where, home, env, options.probe).catch(() => null) : null;
    if (!still() || silent.has(run)) return;
    const name = ANSWERERS[harness].name;
    const reason = quietReason(runner.readErrors?.(run, turn) ?? "", signed);
    const { answer } = runs.ask(
      run,
      quietQuestion(name, reason, options.signIn ? signInCommand(harness) : null, Math.round((options.quietMs ?? QUIET_MS) / 1000)),
    );
    const choice = await answer;
    if (choice === "wait") return waitQuiet(run, harness, turn);
    if (choice === "sign-in") options.signIn?.(harness);
    // Signing in means asking again once it is; the run as it is can't go on.
    if (choice === "sign-in" || choice === "no") stopRun(run);
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

  /** Runs with a folder on disk, whose record is kept there; the record last written for each. */
  const onDisk = new Set<string>();
  const written = new Map<string, string>();
  /** The turn the person stopped, and the turn whose end they were told of, for each run's record. */
  const stoppedTurn = new Map<string, number>();
  const toldTurn = new Map<string, number>();
  /** While runs are picked up again: their records are as they were, not as the replay has them so far. */
  let replaying = false;
  const saveRecords = () => {
    if (replaying) return;
    for (const run of runs.getSnapshot()) {
      if (!onDisk.has(run.id)) continue;
      const policy = policies.get(run.id);
      const record = recordOf(run, {
        unit: unitOf(run.id, run.turn),
        log: streamOf(runtime, run.id, run.turn),
        window: policy?.window ?? null,
        sites: policy?.sites ?? [],
        stopped: stoppedTurn.get(run.id) ?? null,
        told: toldTurn.get(run.id) ?? null,
      });
      const json = JSON.stringify(record);
      if (written.get(run.id) === json) continue;
      written.set(run.id, json);
      runner.save(record);
    }
  };

  // Ended runs: their notification once; runs over an hour old: their files.
  const told = new Set<string>();
  const offRuns = runs.subscribe(() => {
    for (const run of runs.getSnapshot()) {
      const key = `${run.id}:${run.turn}`;
      if (run.ended === null || told.has(key)) continue;
      told.add(key);
      toldTurn.set(run.id, run.turn);
      options.ended?.(run);
    }
    saveRecords();
  });
  const pruner = setInterval(() => {
    for (const run of runs.prune()) {
      runner.forget(run);
      policies.delete(run);
      for (const map of [written, stoppedTurn, toldTurn]) map.delete(run);
      onDisk.delete(run);
    }
  }, 60_000);

  /**
   * What a shell that starts picks up again (pickup.ts): each run whose unit
   * still runs and each ended in the last hour, its policy and what the
   * person was told of it as they were.
   */
  const pickUp = () => {
    if (!runtime) return;
    const { pickUp: found, forget } = runsToPickUp(runner.found(), runner, runtime, options.now?.() ?? Date.now());
    for (const run of forget) runner.forget(run);
    for (const each of found) {
      const { id, harness, turn } = each.record;
      if (runs.get(id)) continue;
      const name = ANSWERERS[harness].name;
      policies.set(id, { granted: TASK_GRANTED, refused: TASK_REFUSED, window: each.record.window, name, sites: new Set(each.record.sites) });
      onDisk.add(id);
      written.set(id, JSON.stringify(each.record));
      if (each.record.stopped !== null) stoppedTurn.set(id, each.record.stopped);
      if (each.record.told !== null) toldTurn.set(id, each.record.told);
      // The person heard of the turns before this one (a follow-up came after them), and of this one if the record says so.
      for (let before = 1; before < turn; before++) told.add(`${id}:${before}`);
      if (each.record.told === turn) told.add(`${id}:${turn}`);
      replaying = true;
      try {
        replayRun(each, name, runs, runner, watch);
      } catch (error) {
        console.error(`dashi-shell: couldn't pick up run ${id} again:`, error);
      } finally {
        replaying = false;
      }
    }
  };
  pickUp();

  const settingAddress = () => options.setSettingAddress?.() ?? null;

  function stopRun(run: string): void {
    const view = runs.get(run);
    if (!view) return;
    heard(run);
    waitingWords.delete(run);
    stoppedTurn.set(run, view.turn);
    runs.stopping(run);
    runner.stop(run, view.turn);
  }

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
      policies.set(id, { granted: TASK_GRANTED, refused: TASK_REFUSED, window: context.window?.id ?? null, name: ANSWERERS[harness].name, sites: new Set() });
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
    stop: (run) => stopRun(run),
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
      saveRecords();
      offSettings();
      offRuns();
      clearInterval(pruner);
      for (const timer of silent.values()) clearTimeout(timer);
      silent.clear();
      for (const { off } of watching.values()) off();
      watching.clear();
    },
  };
}
