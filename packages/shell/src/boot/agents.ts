/**
 * Agents (main.tsx): who is connected, passwords and the vault, the agents'
 * own sheets, the launcher's agent runs (handoff), the agents' MCP server,
 * and Ask in the launcher.
 */

import { formatAddress, type startActions } from "../actions/index.ts";
import { createAgentUi, type QuestionVoice } from "../agent-sheets/index.ts";
import type { Ask } from "../agents/ask/types.ts";
import {
  AgentStore,
  type Agents,
  AloneRecords,
  aloneNotice,
  modelKeys,
  type Passwords,
  personAnswered,
  personPressedWindow,
  SHOW_RECORD,
  serveTokens,
  startAgents,
  startAsk,
  startPasswords,
  TOOLS,
  TurnWatch,
  tokensSocketPath,
  vaultTokenSource,
  WorkAlone,
  watchApprovals,
} from "../agents/index.ts";
import { createApprovalUi } from "../approval-sheet.tsx";
import { SETTINGS_APP_ID } from "../apps.ts";
import type { Compositor } from "../compositor/index.ts";
import { openFile } from "../file-manager.ts";
import { ContextSource, type HandoffShell, startHandoffShell } from "../handoff-shell.tsx";
import { LAUNCHER_MOTION } from "../launcher/resident.tsx";
import { SHELL_SENDER } from "../notifications/index.ts";
import type { Notifications } from "../notifications/service.ts";
import { regionDesktop } from "../region/index.ts";
import type { SettingsStore } from "../settings-app/index.ts";
import { machineDesktop } from "../settings-app/machine-desktop.ts";
import { agentRow, type RegistryStores, valueOf } from "../settings-app/registry/index.ts";
import type { Arranging, Desktops } from "./desktop.ts";
import type { Switches } from "./notices.ts";
import type { Screenshots } from "./overlays.tsx";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";
import type { Stores } from "./session.ts";
import type { SettingsApps } from "./settings.ts";
import type { Guards, SystemStores } from "./system.ts";

type Actions = ReturnType<typeof startActions>;

export interface AgentBasics {
  agentStore: AgentStore;
  passwords: Passwords;
  agentUi: ReturnType<typeof createAgentUi>;
  turnWatch: TurnWatch;
  /** Work alone (agents/alone/): Settings › Agents turns it on, the menu bar shows it, the agents' server asks it. */
  alone: WorkAlone;
}

/** Who is connected, passwords and the vault, the token proxy, and the sheets agents ask through. */
export function startAgentBasics(compositor: Compositor | null, services: Services, voice: QuestionVoice): AgentBasics {
  // Agents (MCP) run here too; they start below, once what they reach exists.
  const agentStore = new AgentStore();
  // Passwords: Dashi's vault and the sources agents sign in from (agents/secrets/).
  const passwords = startPasswords();
  // Agents' API tokens stay home: dashi-agent asks here for its sandbox's token proxy (agents/tokens/).
  services.add("token proxy", serveTokens({ path: tokensSocketPath(), tokens: passwords.vault.tokens }));
  // The vault's questions to the person (a passkey, a payment): fingerprint or password.
  const approvalUi = createApprovalUi();
  watchApprovals(approvalUi);
  // A sheet's yes counts only if the person pressed it (agents/person.ts).
  // An agent's question (`ask_person`) is said in Dashi's voice and answered by the talk key, or typed.
  const agentUi = createAgentUi({
    inputOrigin: (params) => (compositor ? compositor.inputOrigin(params) : Promise.reject(new Error("no compositor"))),
    voice: () => voice,
  });
  services.add("agent sheets", () => agentUi.close());
  // A "Your turn" is in the launcher's Now too while its banner is up (agents/ask/now.ts).
  const turnWatch = new TurnWatch();
  const showTurn = agentUi.turn;
  agentUi.turn = (turn, signal) => turnWatch.track(turn, showTurn(turn, signal));
  // Only the person turns Work alone on, with their own press in Settings; it ends with the shell (logout).
  const alone = new WorkAlone({
    // Its window, by its app id, asked of the compositor (`input-origin`): an agent's pointer or keys there, or no compositor, is a no.
    personPressed: () => (compositor ? personPressedWindow(compositor, SETTINGS_APP_ID) : Promise.resolve(false)),
    records: new AloneRecords(),
  });
  services.add("work alone", () => alone.close());
  return { agentStore, passwords, agentUi, turnWatch, alone };
}

/** An action run as the person, by its address; an address with nothing at it is an error, not a throw. */
function runAddressAsPerson(actions: Actions, address: string, args: Record<string, unknown>) {
  const action = actions.registry.get(address);
  return action ? actions.run(action, args) : Promise.resolve({ ok: false as const, error: `Nothing is at ${address}.` });
}

/** The Terminal, through its action (a harness that isn't signed in signs in there). */
function openTerminal(actions: Actions): void {
  const terminal = actions.registry.get(formatAddress(["app", "dev.dashi.terminal"]));
  if (terminal) void actions.run(terminal, {});
}

/** A registry setting's value now, by the name agents know it by (settings-app/registry/). */
function settingNow(name: string, stores: RegistryStores) {
  const row = agentRow(name);
  return row ? valueOf(row, stores) : null;
}

export interface Handoff {
  handoffShell: HandoffShell;
  /** The window, page and selection the next launcher opens with. */
  launcherContext: ContextSource;
  /** The run the next launcher opens talking to (a notification's Follow up). */
  talk: { run: string | null };
}

interface HandoffNeeds {
  compositor: Compositor | null;
  settingsStore: SettingsStore;
  agentStore: AgentStore;
  notifications: Notifications;
  registryStores: RegistryStores;
  services: Services;
  late: Late<LateParts>;
}

/**
 * Agents from the launcher (agents/handoff/): tasks run in the background as user services, through
 * dashi-agent; one chip in the menu bar, its panel for their cards and questions, a notification when done.
 * What they reach (the registry, the menus, the launcher) is late-bound: they start once a person asks.
 */
export function startHandoff({ compositor, settingsStore, agentStore, notifications, registryStores, services, late }: HandoffNeeds): Handoff {
  const launcherContext = new ContextSource();
  const talk: { run: string | null } = { run: null };
  const handoffShell = startHandoffShell({
    settings: settingsStore,
    env: process.env,
    agents: agentStore,
    // The agents' server starts below; the panel's Stop reaches it once it has.
    stopAgent: (id) => late.get("agents")?.stop(id),
    stopAgents: () => late.get("agents")?.stopAll(),
    notifications: notifications.store,
    menus: () => late.get("menus").controller,
    personPressed: (layer) => (compositor ? personAnswered((params) => compositor.inputOrigin(params), layer) : Promise.resolve(false)),
    titleOf: (tool) => TOOLS.find((each) => each.name === tool)?.title,
    settingNow: (name) => settingNow(name, registryStores),
    setSettingAddress: () =>
      late
        .get("actions")
        .registry.list()
        .find((action) => action.tool === "set_setting")?.address ?? null,
    runAsPerson: (address, args) => runAddressAsPerson(late.get("actions"), address, args),
    openFile: (path) => openFile(`file://${path}`),
    openSettings: () => late.get("settingsApp").open("agents"),
    openTerminal: () => openTerminal(late.get("actions")),
    talkTo: (run) => {
      const overlays = late.get("overlays");
      if (overlays.has("launcher")) overlays.close("launcher");
      talk.run = run;
      late.get("launcher").open();
    },
  });
  services.add("handoff", () => handoffShell.close());
  return { handoffShell, launcherContext, talk };
}

/** When Work alone ends, a notification says why and what agents did; Show opens its record in Settings › Agents. */
function aloneNotices(alone: WorkAlone, notifications: Notifications, show: () => void): () => void {
  const posted = new Set<number>();
  const offEnd = alone.onEnd((record) => posted.add(notifications.store.notify(aloneNotice(record), 0, SHELL_SENDER)));
  const offActions = notifications.store.onEvent((event) => {
    if (event.type === "action" && posted.has(event.id) && (event.key === SHOW_RECORD || event.key === "default")) show();
  });
  return () => {
    offEnd();
    offActions();
  };
}

interface ServerNeeds {
  compositor: Compositor | null;
  basics: AgentBasics;
  handoff: Handoff;
  stores: Stores;
  desktops: Desktops;
  arranging: Arranging;
  system: SystemStores;
  guards: Guards;
  notifications: Notifications;
  switches: Switches;
  settings: Pick<SettingsApps, "forceQuit" | "paneServicesOf">;
  screenshots: Screenshots;
  services: Services;
  late: Late<LateParts>;
}

/** The agents' MCP server: they reach the same stores and controllers the menus use (agents/desktop/). */
export function startAgentServer(needs: ServerNeeds): Agents | null {
  const { compositor, basics, handoff, stores, desktops, arranging, system, guards, notifications, switches, settings, screenshots, late } = needs;
  const { settingsStore } = stores;
  const agents = compositor
    ? startAgents({
        compositor,
        // A launcher run's questions go to the agents' panel (and the sheets while it is closed).
        ui: handoff.handoffShell.ui(basics.agentUi),
        tasks: {
          policy: handoff.handoffShell.service.policy,
          before: handoff.handoffShell.service.before,
          after: handoff.handoffShell.service.after,
        },
        alone: basics.alone,
        sources: basics.passwords.sources,
        vault: basics.passwords.vault,
        store: basics.agentStore,
        tile: arranging.tile,
        arrangement: arranging.arrangement,
        desktop: {
          notifications: notifications.store,
          flags: switches.flags,
          dock: stores.dockPrefs,
          wifi: system.wifiStore,
          forceQuit: settings.forceQuit,
          rememberScale: (name, scale) => settingsStore.setDisplayScale(name, scale),
          ...(desktops.displays ? { displays: desktops.displays } : {}),
          ...(desktops.spaces ? { spaces: desktops.spaces.controller } : {}),
          // The registry's rows agents may change go through settings.json, as the panes' do (settings-app/registry/).
          settings: settingsStore,
          lock: () => guards.lockScreen?.lock(),
          region: regionDesktop(stores.region.store, settingsStore),
          machine: machineDesktop(settings.paneServicesOf, settingsStore),
          // Late-bound: the Setup Assistant is made after the agents, and an agent can only call it once connected.
          setup: { open: (page) => late.get("setupAssistant")?.open(page) },
          // Late-bound like the Setup Assistant: the menu bar's menus, apps' own included.
          menus: { of: (window) => late.get("menus").menusOf(window), run: (action, appName) => late.get("menus").run(action, appName) },
          // Late-bound too: ❖ chords an agent presses in Dashi's apps choose their menu items, as the person's do.
          appShortcut: (window, shortcut) => late.get("appShortcut")(window, shortcut),
          ...(screenshots.tools ? { recorder: screenshots.tools.recorder } : {}),
          // Late-bound too: the clipboard history starts with the launcher's registry (clipboard/).
          clipboard: { recent: (limit) => late.peek("clipboard")?.recent(limit) ?? [] },
        },
      })
    : null;
  needs.services.add("agents", () => agents?.close());
  needs.services.add(
    "work alone notices",
    aloneNotices(basics.alone, notifications, () => late.get("settingsApp").open("agents", "work-alone")),
  );
  return agents;
}

interface AskNeeds {
  compositor: Compositor | null;
  settingsStore: SettingsStore;
  basics: AgentBasics;
  agents: Agents | null;
  actions: Actions;
  registryStores: RegistryStores;
  services: Services;
  late: Late<LateParts>;
}

/**
 * Agents in the launcher (agents/ask/): Ask, the plan run by the person's own Return, Now, and the history.
 * The answerer is Settings › Agents' choice; Claude's key is the vault's token item, else ANTHROPIC_API_KEY.
 */
export function startAskAgents({ compositor, settingsStore, basics, agents, actions, registryStores, services, late }: AskNeeds): Ask {
  const askAgents = startAsk({
    settings: settingsStore,
    agents: basics.agentStore,
    turns: basics.turnWatch,
    actions: () => actions.registry.list(),
    runApproved: (action, args, by) => actions.runApproved(action, args, by),
    runAsPerson: (address, args) => runAddressAsPerson(actions, address, args),
    personPressed: () => (compositor ? personAnswered((params) => compositor.inputOrigin(params), LAUNCHER_MOTION.namespace) : Promise.resolve(false)),
    settingNow: (name) => settingNow(name, registryStores),
    focus: async (window) => {
      await compositor?.focus({ window });
    },
    stopAgent: (id) => agents?.stop(id),
    openSettings: () => late.get("settingsApp").open("agents"),
    // A harness that isn't signed in signs in there (agents/ask/harness/).
    openTerminal: () => openTerminal(actions),
    keys: modelKeys(vaultTokenSource(basics.passwords.vault.tokens)),
  });
  services.add("ask", () => askAgents.close());
  return askAgents;
}
