/** What the launcher's agents are given and what they offer: the settings read, how harnesses run, and the stores they come to. */

import type { ActionDef, ActionState, Args, Outcome } from "../../actions/types.ts";
import type { LauncherAgents } from "../../launcher/index.ts";
import type { AgentStore } from "../presence.ts";
import type { AnswererChoice, AnswererInfo, AnswerFailure } from "./answerer.ts";
import type { Files, HarnessStatus, Probe, Runner, ShellPaths } from "./harness/index.ts";
import type { HistoryEntry, HistoryLog } from "./history.ts";
import type { KeyPlace, ModelKeys, Provider } from "./keys.ts";
import type { Fetch } from "./lib/http.ts";
import type { AskTasks } from "./lib/tasks.ts";
import type { TurnWatch } from "./now.ts";
import type { Step, Undo } from "./plan.ts";

/** The part of settings.json this reads (settings-app/store.ts `agents`). */
export interface AskSettings {
  getSnapshot(): { data: { agents: { answerer?: AnswererChoice; localModel?: string; gptModel?: string } } };
  subscribe(listener: () => void): () => void;
}

/** How harnesses are found and run; the session's own unless a test says otherwise. */
export interface HarnessHost {
  env: Readonly<Record<string, string | undefined>>;
  files?: Files;
  probe?: Probe;
  run?: Runner;
  shell?: ShellPaths;
  /** Run the harness itself, not through dashi-agent (tests: no bubblewrap or systemd there). */
  direct?: boolean;
  timeoutMs?: number;
}

export interface AskOptions {
  settings: AskSettings;
  /** The agents connected over MCP (the menu bar's store). */
  agents: Pick<AgentStore, "subscribe" | "getSnapshot">;
  turns: TurnWatch;
  /** Every action in the registry: a plan's tools are the ones both the person and agents use. */
  actions(): readonly ActionDef[];
  /** One approved step (actions/start.ts `runApproved`). */
  runApproved(action: ActionDef, args: Args, by: { agent: string; task: string }): Promise<Outcome>;
  /** The action at an address, run as the person (Undo). */
  runAsPerson(address: string, args: Args): Promise<Outcome>;
  /** `input-origin` on the launcher's layer says the person's own hands pressed it; a spoken yes counts for the `task` it answered only. */
  personPressed(task: string): Promise<boolean>;
  settingNow(name: string): ActionState;
  /** Bring a window forward (a "Your turn"). */
  focus(window: number): Promise<void>;
  /** Cut an MCP agent off (the pill's stop square). */
  stopAgent(id: number): void;
  /** System Settings › Agents. */
  openSettings(): void;
  /** Terminal, where a harness signs in ("Claude Code isn't signed in. Return opens Terminal to sign in."). */
  openTerminal?(): void;
  keys: ModelKeys;
  fetch?: Fetch;
  history?: HistoryLog;
  harnesses?: HarnessHost;
}

/** What Settings › Agents reads besides settings.json. */
export interface AnswerStatus {
  /** Where a provider's key is (Claude's by default). */
  keyPlace(provider?: Provider): Promise<KeyPlace>;
  /** The models installed here; null when no local model server runs. */
  localModels(): Promise<string[] | null>;
  /** The chat models GPT's key lists, the most capable first; null without a key or an answer. */
  gptModels(): Promise<string[] | null>;
  /** Claude Code, Codex and OpenCode: installed or not, and signed in where that's cheap to tell. */
  harnesses(): Promise<HarnessStatus[]>;
  history(): readonly HistoryEntry[];
  onHistory(listener: () => void): () => void;
  undo(entry: string, step: number, undo: Undo): Promise<Outcome>;
}

export interface Ask {
  launcher: LauncherAgents;
  status: AnswerStatus;
  tasks: AskTasks;
  close(): void;
}

/** What a launcher Ask task shows. */
export type TaskPhase = "asking" | "planned" | "running" | "done" | "failed" | "stopped";

export interface TaskView {
  id: string;
  answerer: AnswererInfo;
  /** The words this plan answers (the latest follow-up's). */
  request: string;
  phase: TaskPhase;
  steps: readonly Step[];
  /** What the model said besides its calls, on one line. */
  said: string;
  failure: { kind: AnswerFailure; text: string } | null;
  /** A failed ask that has left "Now" (a while after, or once the launcher closed); still Retry-able from its plan, and in the history. */
  leftNow?: true;
}
