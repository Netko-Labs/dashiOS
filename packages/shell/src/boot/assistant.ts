/**
 * Dashi's assistant, as it is talked to (main.tsx; agents/assistant/;
 * decisions.md D147 to D149): made with the voice loop, before most of what
 * it reaches exists, so everything it uses is looked up when the person
 * asks. `hostAssistant` gives it the pieces that are not late parts of
 * their own (the sheets, the keys, the settings' values).
 */

import type { ActionState } from "../actions/types.ts";
import {
  type AgentUi,
  type Assistant,
  hostFiles,
  type ModelKeys,
  type Moment,
  modelKeys,
  shellPaths,
  startAssistant,
  type TaskHooks,
  type TaskPolicy,
  talkWords,
  USUAL_NAMES,
  vaultTokenSource,
} from "../agents/index.ts";
import type { Compositor } from "../compositor/index.ts";
import { loadEntries } from "../entries.ts";
import { primarySelection } from "../handoff-shell.tsx";
import type { SettingsStore } from "../settings-app/index.ts";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";

/** What the assistant uses that only main.tsx can hand it, once it exists. */
export interface AssistantHost {
  ui: Pick<AgentUi, "ask">;
  keys: ModelKeys;
  settingNow(name: string): ActionState;
}

/** The sheets, the person's keys and the settings' values, for the assistant, which was made before they were. */
export function hostAssistant(
  late: Late<LateParts>,
  ui: AssistantHost["ui"],
  tokens: Parameters<typeof vaultTokenSource>[0],
  settingNow: AssistantHost["settingNow"],
): void {
  late.set("assistantHost", { ui, keys: modelKeys(vaultTokenSource(tokens)), settingNow });
}

type Hooks = TaskHooks & { policy(task: string): TaskPolicy | null };

/** The agents' server's hooks for a task's connection: the assistant's for its own conversation, else the launcher runs'. */
export function taskHooks(late: Late<LateParts>, runs: Hooks): Hooks {
  const own = (task: string): Assistant | null => (late.peek("assistant")?.policy(task) ? late.get("assistant") : null);
  return {
    policy: (task) => late.peek("assistant")?.policy(task) ?? runs.policy(task),
    before: (task, call) => (own(task) ?? runs).before(task, call),
    after: (task, undo, ok) => (own(task) ?? runs).after(task, undo, ok),
  };
}

interface AssistantNeeds {
  compositor: Compositor | null;
  settingsStore: SettingsStore;
  services: Services;
  late: Late<LateParts>;
  /** Plan mode: the launcher's planner, as 0.8's voice asked it. */
  planner: { ask(words: string, signal: AbortSignal): Promise<{ say: string; failed?: { go?: "voice" | "agents" | "launcher" } }> };
}

/** How long the list of installed apps is kept before it is read again. */
const APPS_FRESH_MS = 300_000;

/** The moment something is said in: what is in front, the selection, the Desktop, the apps. Nothing here fails an ask: what can't be read is left out. */
function momentReader(compositor: Compositor | null, late: Late<LateParts>): () => Promise<Moment> {
  let apps: { names: string[]; at: number } | null = null;
  const appNames = (): string[] => {
    if (!apps || Date.now() - apps.at > APPS_FRESH_MS) {
      try {
        apps = { names: [...new Set(loadEntries().map((entry) => entry.name))].sort(), at: Date.now() };
      } catch {
        apps = { names: [], at: Date.now() };
      }
    }
    return apps.names;
  };
  return async () => {
    const [windows, selection] = await Promise.all([compositor?.windows().catch(() => []) ?? [], primarySelection().catch(() => null)]);
    const front = windows.find((window) => window.focused && window.state === "normal");
    const browser = front && /helium|chrom/i.test(front.appId);
    const page = browser
      ? await (late
          .peek("agents")
          ?.frontPage()
          .catch(() => null) ?? null)
      : null;
    const spaces = [...new Set(windows.map((window) => window.space ?? 0))];
    const shown = front?.space ?? 0;
    const persona = late.peek("pill")?.persona.getSnapshot();
    return {
      window: front
        ? { app: late.peek("nameApp")?.(front) ?? front.appId, title: front.title, url: page?.url && /^https?:/.test(page.url) ? page.url : null }
        : null,
      selection: selection?.trim() ? selection : null,
      time: new Date(),
      language: (process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "").split(".")[0] || undefined,
      desktop: front
        ? { index: shown + 1, of: Math.max(shown + 1, spaces.length), windows: windows.filter((window) => (window.space ?? 0) === shown).length }
        : null,
      apps: appNames(),
      names: USUAL_NAMES,
      talk: talkWords(persona?.talk ?? "normal"),
      about: "",
    };
  };
}

export function startAssistantPiece({ compositor, settingsStore, services, late, planner }: AssistantNeeds): Assistant {
  let locked = false;
  const offLock = compositor?.on((event) => {
    if (event.event === "lock") locked = event.locked;
  });
  const setSetting = (): string | null =>
    late
      .peek("actions")
      ?.registry.list()
      .find((action) => action.tool === "set_setting")?.address ?? null;
  const assistant = startAssistant({
    settings: () => {
      const { agents, voice } = settingsStore.getSnapshot().data;
      return { agents, voice };
    },
    agents: () => late.peek("agents") ?? null,
    ui: () => late.peek("assistantHost")?.ui ?? null,
    planner,
    keys: {
      anthropic: async () => (await late.peek("assistantHost")?.keys.anthropic()) ?? null,
      openai: async () => (await late.peek("assistantHost")?.keys.openai()) ?? null,
      place: async (provider) => (await late.peek("assistantHost")?.keys.place(provider)) ?? "none",
    },
    harness: { env: process.env, shell: shellPaths(), files: hostFiles },
    moment: momentReader(compositor, late),
    name: () => late.peek("pill")?.persona.getSnapshot().name ?? "Dashi",
    locked: () => locked,
    settingNow: (name) => late.peek("assistantHost")?.settingNow(name) ?? null,
    setSettingAddress: setSetting,
    runUndo: async (undo) => {
      const actions = late.peek("actions");
      const action = actions?.registry.get(undo.address);
      return action && actions ? actions.run(action, undo.args) : { ok: false as const, error: `Nothing is at ${undo.address}.` };
    },
    history: { add: (record) => late.peek("askAgents")?.history.add(record), undone: (task, step) => late.peek("askAgents")?.history.undone(task, step) },
    log: (line) => console.error(`dashi-shell: ${line}`),
  });
  services.add("assistant", () => {
    offLock?.();
    assistant.close();
  });
  return late.set("assistant", assistant);
}
