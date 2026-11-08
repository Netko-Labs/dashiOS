/**
 * The launcher's agents, put together (main.tsx starts it): the answerer
 * Settings names, the Ask tasks, the "Your turn" banners, the agents
 * connected over MCP, and the history, as the one store the launcher reads
 * (launcher/agents/rows.ts `LauncherAgents`) and the few reads Settings ›
 * Agents needs (`AnswerStatus`).
 *
 * The only network it adds is the chosen answerer's own: Anthropic's API for
 * Claude, OpenAI's for GPT, the loopback for a local model, or the harness
 * the person picked (Claude Code, Codex, OpenCode), which reaches its own
 * provider with its own login from its sandbox. Nothing is sent until the
 * person asks.
 */

import { readFileSync } from "node:fs";
import type { ActionDef, ActionState, Args, Outcome } from "../../actions/types.ts";
import type { LauncherAgents, LauncherAgentsSnapshot } from "../../launcher/agents/rows.ts";
import type { AgentStore, Turn } from "../presence.ts";
import { unitName } from "../sandbox.ts";
import { type Answerer, type AnswererChoice, answererOf, HARNESS_IDS, type HarnessId, isHarnessId } from "./answerer.ts";
import { claudeAnswerer, type Fetch } from "./claude.ts";
import { gptAnswerer, listGptModels } from "./gpt.ts";
import {
  type Files,
  findHarness,
  HARNESSES,
  type HarnessStatus,
  harnessAnswerer,
  harnessStatuses,
  hostFiles,
  hostRunner,
  type Probe,
  type Runner,
  type ShellPaths,
  shellPaths,
} from "./harness/index.ts";
import { type HistoryEntry, HistoryLog } from "./history.ts";
import { type KeyPlace, keyPlace, type ModelKeys, type Provider } from "./keys.ts";
import { localAnswerer, localModels } from "./local.ts";
import { type NowItem, nowItems, type TurnWatch } from "./now.ts";
import type { Undo } from "./plan.ts";
import { AskTasks } from "./tasks.ts";

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

/** The scope a harness's turn runs in: dashi-agent names it after itself (sandbox.ts `unitName`). */
const planUnit = (id: HarnessId, pid: number): string => unitName(`plan-${id}`, pid);

/** Whether the process `pid` is in the scope `unit` (its cgroup, from /proc). */
function inUnit(pid: number, unit: string): boolean {
  try {
    const line = readFileSync(`/proc/${pid}/cgroup`, "utf8")
      .split("\n")
      .find((entry) => entry.startsWith("0::"));
    return line?.slice(3).split("/").includes(unit) ?? false;
  } catch {
    return false;
  }
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
  /** `input-origin` on the launcher's layer says the person's own hands pressed it. */
  personPressed(): Promise<boolean>;
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

/** How long a read of the history stands for the launcher's keystrokes ("history" re-renders on each). */
const HISTORY_FRESH_MS = 3_000;

export function startAsk(options: AskOptions): Ask {
  const history = options.history ?? new HistoryLog();
  const choice = () => options.settings.getSnapshot().data.agents.answerer;
  const host: HarnessHost = options.harnesses ?? { env: process.env };
  const files = host.files ?? hostFiles;
  const shell = host.shell ?? shellPaths();
  const fetching = options.fetch ? { fetch: options.fetch } : {};
  const harness = (id: HarnessId): Answerer => {
    const spec = HARNESSES[id];
    return harnessAnswerer({
      spec,
      find: () => (host.env.HOME ? findHarness(spec, host.env.HOME, host.env.PATH, files) : null),
      run: host.run ?? hostRunner((pid) => planUnit(id, pid)),
      shell,
      env: host.env,
      // Only this turn's sandbox may reach its plan socket.
      fromTurn: (peer, agent) => host.direct === true || (peer !== null && agent !== null && inUnit(peer, planUnit(id, agent))),
      ...(host.direct ? { direct: true } : {}),
      ...(host.timeoutMs ? { timeoutMs: host.timeoutMs } : {}),
    });
  };
  let made: { choice: AnswererChoice | undefined; answerer: Answerer | null } | null = null;
  const answerer = (): Answerer | null => {
    const now = choice();
    if (made !== null && made.choice === now) return made.answerer;
    const info = answererOf(now);
    const id = info?.id;
    const answer =
      id === undefined
        ? null
        : isHarnessId(id)
          ? harness(id)
          : id === "local"
            ? localAnswerer({ model: () => options.settings.getSnapshot().data.agents.localModel ?? null, ...fetching })
            : id === "claude"
              ? claudeAnswerer({ key: async () => (await options.keys.anthropic())?.key ?? null, ...fetching })
              : gptAnswerer({
                  key: async () => (await options.keys.openai())?.key ?? null,
                  model: () => options.settings.getSnapshot().data.agents.gptModel ?? null,
                  ...fetching,
                });
    made = { choice: now, answerer: answer };
    return answer;
  };

  const tasks = new AskTasks({
    answerer,
    actions: options.actions,
    run: options.runApproved,
    personPressed: options.personPressed,
    settingNow: options.settingNow,
    undo: (undo) => options.runAsPerson(undo.address, undo.args),
    history,
  });

  // One snapshot, made again only when something under it changed.
  let seen: { choice: AnswererChoice | undefined; tasks: unknown; turns: readonly Turn[]; agents: unknown } | null = null;
  let snapshot: LauncherAgentsSnapshot = { answerer: null, unset: true, now: [], tasks: [] };
  const getSnapshot = (): LauncherAgentsSnapshot => {
    const now = { choice: choice(), tasks: tasks.getSnapshot(), turns: options.turns.getSnapshot(), agents: options.agents.getSnapshot() };
    if (seen && seen.choice === now.choice && seen.tasks === now.tasks && seen.turns === now.turns && seen.agents === now.agents) return snapshot;
    seen = now;
    snapshot = {
      answerer: answererOf(now.choice),
      unset: now.choice === undefined,
      now: nowItems({ turns: now.turns, tasks: now.tasks, agents: options.agents.getSnapshot() }),
      tasks: now.tasks,
    };
    return snapshot;
  };

  let read: { at: number; entries: readonly HistoryEntry[] } | null = null;
  const offHistory = history.subscribe(() => {
    read = null;
  });
  const readHistory = (): readonly HistoryEntry[] => {
    if (read && Date.now() - read.at < HISTORY_FRESH_MS) return read.entries;
    read = { at: Date.now(), entries: history.read() };
    return read.entries;
  };

  const undo = (entry: string, step: number, value: Undo) => tasks.undo(entry, step, value);

  const launcher: LauncherAgents = {
    subscribe(listener) {
      const offs = [options.settings.subscribe(listener), tasks.subscribe(listener), options.turns.subscribe(listener), options.agents.subscribe(listener)];
      return () => {
        for (const off of offs) off();
      };
    },
    getSnapshot,
    ask: (request, context) => tasks.ask(request, context),
    followUp: (task, text) => tasks.followUp(task, text),
    run: (task) => void tasks.run(task),
    allowOnce: (task, step) => void tasks.allowOnce(task, step),
    retry: (task) => tasks.retry(task),
    undo,
    entryOf: (task) => tasks.entryOf(task),
    stop(item: NowItem) {
      if (item.kind === "task") tasks.stop(item.id);
      else options.stopAgent(item.kind === "turn" ? item.agent : item.id);
    },
    async goTo(item) {
      if (item.kind === "turn" && item.window !== null) await options.focus(item.window).catch(() => {});
    },
    setUp: options.openSettings,
    signIn: () => (options.openTerminal ?? options.openSettings)(),
    history: readHistory,
    closed: () => tasks.letFailedGo(),
  };

  const status: AnswerStatus = {
    keyPlace: (provider) => keyPlace(options.keys, provider),
    localModels: () => localModels(options.fetch),
    async gptModels() {
      const found = await options.keys.openai();
      if (!found) return null;
      return listGptModels(found.key, fetching).catch(() => null);
    },
    harnesses: () =>
      harnessStatuses(
        HARNESS_IDS.map((id) => HARNESSES[id]),
        host.env,
        files,
        host.probe,
      ),
    history: readHistory,
    onHistory: history.subscribe,
    undo,
  };

  return {
    launcher,
    status,
    tasks,
    close() {
      offHistory();
      for (const task of tasks.getSnapshot()) if (task.phase === "asking" || task.phase === "running") tasks.stop(task.id);
    },
  };
}
