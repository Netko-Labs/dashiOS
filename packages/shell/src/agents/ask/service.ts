/**
 * The launcher's agents, put together (main.tsx starts it): the answerer
 * Settings names, the Ask tasks, the "Your turn" banners, the agents
 * connected over MCP, and the history, as the one store the launcher reads
 * (launcher/agents/rows.ts `LauncherAgents`) and the few reads Settings ›
 * Agents needs (`AnswerStatus`).
 *
 * The only network it adds is the chosen answerer's own API: Anthropic's for
 * Claude, the loopback for a local model. Nothing is sent until the person
 * asks.
 */

import type { ActionDef, ActionState, Args, Outcome } from "../../actions/types.ts";
import type { LauncherAgents, LauncherAgentsSnapshot } from "../../launcher/agents/rows.ts";
import type { AgentStore, Turn } from "../presence.ts";
import { type Answerer, type AnswererChoice, answererOf } from "./answerer.ts";
import { claudeAnswerer, type Fetch } from "./claude.ts";
import { type HistoryEntry, HistoryLog } from "./history.ts";
import { type KeyPlace, keyPlace, type ModelKeys } from "./keys.ts";
import { localAnswerer, localModels } from "./local.ts";
import { type NowItem, nowItems, type TurnWatch } from "./now.ts";
import type { Undo } from "./plan.ts";
import { AskTasks } from "./tasks.ts";

/** The part of settings.json this reads (settings-app/store.ts `agents`). */
export interface AskSettings {
  getSnapshot(): { data: { agents: { answerer?: AnswererChoice; localModel?: string } } };
  subscribe(listener: () => void): () => void;
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
  keys: ModelKeys;
  fetch?: Fetch;
  history?: HistoryLog;
}

/** What Settings › Agents reads besides settings.json. */
export interface AnswerStatus {
  keyPlace(): Promise<KeyPlace>;
  /** The models installed here; null when no local model server runs. */
  localModels(): Promise<string[] | null>;
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
  let made: { choice: AnswererChoice | undefined; answerer: Answerer | null } | null = null;
  const answerer = (): Answerer | null => {
    const now = choice();
    if (made !== null && made.choice === now) return made.answerer;
    const info = answererOf(now);
    const answer =
      info?.id === "local"
        ? localAnswerer({ model: () => options.settings.getSnapshot().data.agents.localModel ?? null, ...(options.fetch ? { fetch: options.fetch } : {}) })
        : info?.id === "claude"
          ? claudeAnswerer({ key: async () => (await options.keys.anthropic())?.key ?? null, ...(options.fetch ? { fetch: options.fetch } : {}) })
          : null;
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
    ask: (request) => tasks.ask(request),
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
    history: readHistory,
  };

  const status: AnswerStatus = {
    keyPlace: () => keyPlace(options.keys),
    localModels: () => localModels(options.fetch),
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
