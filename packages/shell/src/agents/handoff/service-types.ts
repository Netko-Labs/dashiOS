/** What the launcher's agents are put together from: the settings it reads, its options, the policy of a run's connection, and what it offers. */

import type { HarnessId } from "../ask/answerer.ts";
import type { Files, Probe, ShellPaths } from "../ask/harness/index.ts";
import type { Undo } from "../ask/plan.ts";
import type { Scope } from "../consent.ts";
import type { Call } from "../tools/index.ts";
import type { GrantsMemory, TaskContext } from "./grants.ts";
import type { TaskRunner } from "./runner.ts";
import type { AgentRuns, RunView } from "./store.ts";

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

/** What the parts of the service share: its options and the places they read, the runner, the runs, and each run's policy. */
export interface HandoffDeps {
  options: HandoffOptions;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  runtime: string;
  files: Files;
  shell: ShellPaths & { task: string };
  runner: TaskRunner;
  runs: AgentRuns;
  policies: Map<string, TaskPolicy>;
}
