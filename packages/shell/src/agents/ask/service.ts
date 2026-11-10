/**
 * The launcher's agents, put together (main.tsx starts it): the answerer
 * Settings names, the Ask tasks, the "Your turn" banners, the agents
 * connected over MCP, and the history, as the one store the launcher reads
 * (launcher/types.ts `LauncherAgents`) and the few reads Settings ›
 * Agents needs (`AnswerStatus`).
 *
 * The only network it adds is the chosen answerer's own: Anthropic's API for
 * Claude, OpenAI's for GPT, the loopback for a local model, or the harness
 * the person picked (Claude Code, Codex, OpenCode), which reaches its own
 * provider with its own login from its sandbox. Nothing is sent until the
 * person asks.
 */

import type { LauncherAgents } from "../../launcher/index.ts";
import { HARNESS_IDS } from "./answerer.ts";
import { HARNESSES, harnessStatuses, hostFiles } from "./harness/index.ts";
import { HistoryLog } from "./history.ts";
import { keyPlace } from "./keys.ts";
import { chosenAnswerer } from "./lib/chosen-answerer.ts";
import { listGptModels } from "./lib/gpt.ts";
import { cachedHistory, launcherSnapshot } from "./lib/launcher-snapshot.ts";
import { AskTasks } from "./lib/tasks.ts";
import { localModels } from "./local.ts";
import type { NowItem } from "./now.ts";
import type { Undo } from "./plan.ts";
import type { AnswerStatus, Ask, AskOptions, HarnessHost } from "./types.ts";

export function startAsk(options: AskOptions): Ask {
  const history = options.history ?? new HistoryLog();
  const host: HarnessHost = options.harnesses ?? { env: process.env };
  const files = host.files ?? hostFiles;
  const fetching = options.fetch ? { fetch: options.fetch } : {};
  const tasks = new AskTasks({
    answerer: chosenAnswerer(options),
    actions: options.actions,
    run: options.runApproved,
    personPressed: options.personPressed,
    settingNow: options.settingNow,
    undo: (undo) => options.runAsPerson(undo.address, undo.args),
    history,
  });
  const getSnapshot = launcherSnapshot(options, tasks);
  const kept = cachedHistory(history);
  const readHistory = kept.read;

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
      kept.off();
      for (const task of tasks.getSnapshot()) if (task.phase === "asking" || task.phase === "running") tasks.stop(task.id);
    },
  };
}
