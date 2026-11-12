/**
 * The shell's own apps for settings (main.tsx): Force Quit, System Settings and
 * the stores its machine panes read, the Setup Assistant, and Dark Mode by the
 * time of day.
 */

import { type AgentStore, type Agents, Grants, type Passwords } from "../agents/index.ts";
import { AutoAppearance } from "../appearance/index.ts";
import type { Compositor } from "../compositor/index.ts";
import { type ForceQuit, startForceQuit } from "../force-quit/index.ts";
import { type SettingsApp, startSettingsApp } from "../settings-app/index.ts";
import { registerPaneEntries } from "../settings-app/search.ts";
import { createPaneServices, type PaneServices } from "../settings-app/services.ts";
import { type SetupAssistant, startSetupAssistant } from "../setup/index.ts";
import type { Desktops } from "./desktop.ts";
import type { Switches } from "./notices.ts";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";
import type { Stores } from "./session.ts";
import type { Guards, SystemStores } from "./system.ts";

export interface SettingsApps {
  forceQuit: ForceQuit;
  /**
   * The machine panes' stores (Network, Bluetooth, Sound, Battery & Power, Users & Accounts), made when
   * Settings or an agent first needs them, from the stores the menus run (menus/start.tsx).
   */
  paneServicesOf: () => PaneServices;
}

/** Force Quit Applications, and the machine panes' stores, made on first use. */
export function startSettingsApps(compositor: Compositor | null, system: SystemStores, services: Services, late: Late<LateParts>): SettingsApps {
  // Force Quit Applications: from the Dashi menu and ⌥❖Esc (force-quit/).
  const forceQuit = startForceQuit(compositor);
  services.add("force quit", () => forceQuit.close());
  let paneServices: PaneServices | undefined;
  services.add("settings services", () => paneServices?.close());
  const paneServicesOf = (): PaneServices =>
    (paneServices ??= createPaneServices({
      shared: late.get("menus").shared,
      system: system.system.store,
      battery: late.get("batteryMonitor"),
      laptop: late.get("laptop"),
      refresh: late.get("autoRefresh"),
    }));
  return { forceQuit, paneServicesOf };
}

interface SettingsWindowNeeds {
  compositor: Compositor | null;
  stores: Stores;
  desktops: Desktops;
  system: SystemStores;
  guards: Guards;
  switches: Switches;
  passwords: Passwords;
  agentStore: AgentStore;
  agents: Agents | null;
  settingsApps: SettingsApps;
  services: Services;
  late: Late<LateParts>;
}

export interface SettingsWindows {
  settingsApp: SettingsApp;
  setupAssistant: SetupAssistant;
}

/**
 * System Settings: from the Dashi menu, ❖, and the launcher (settings-app/). It registers itself as a
 * shell app, so it comes before the catalogs. Then the Setup Assistant, and Dark Mode by the time of day.
 */
export function startSettingsWindows(needs: SettingsWindowNeeds): SettingsWindows {
  const { compositor, stores, desktops, guards, switches, agents, services, late } = needs;
  const { settingsStore } = stores;
  // Control Center's stores for Settings › Control Center, once the menus have made them.
  const settingsApp = startSettingsApp({
    controlCenter: () => late.peek("controlCenterEditor") ?? null,
    compositor,
    displays: desktops.displays,
    settings: settingsStore,
    region: stores.region.store,
    passwords: needs.passwords,
    clipboard: () => late.peek("clipboard")?.history ?? null,
    // Read when the window opens, after the catalog is.
    installedApp: (id) => late.get("installedApp")(id),
    openSetup: () => late.get("setupAssistant")?.open(),
    flags: switches.flags,
    // The kept agent answers the sessions use; a fresh read of the file with no agents.
    grants: agents?.grants ?? new Grants(),
    // The person's own list of sites agents may use (Settings › Agents); without the agents' server, none to keep.
    ...(agents ? { sites: agents.sites } : {}),
    ...(guards.privacy ? { privacy: guards.privacy.store } : {}),
    answers: () => late.peek("askAgents")?.status ?? null,
    lock: () => guards.lockScreen?.lock(),
    services: needs.settingsApps.paneServicesOf,
    // Its Edit menu (Undo a setting) goes in the menu bar's store, made later.
    menus: () => late.get("appMenus").store,
    // Who is connected now, for Settings › Agents.
    agents: needs.agentStore,
  });
  late.set("settingsApp", settingsApp);
  services.add("settings app", () => settingsApp.close());

  // The Setup Assistant: at a person's first login, and from Settings > About and the launcher (setup/).
  // The launcher finds each Settings pane ("display" opens Displays).
  registerPaneEntries((pane) => settingsApp.open(pane));
  const setupAssistant = startSetupAssistant({
    compositor,
    settings: settingsStore,
    region: stores.region.store,
    flags: switches.flags,
    wifi: needs.system.wifiStore,
    system: needs.system.system.store,
    // Its last page teaches ❖ (setup/lib/pages/done.tsx): Try it opens the launcher.
    openLauncher: () => late.get("launcher").show(),
    // Its Agents page lists the harnesses installed (agents/ask/choices.ts).
    answers: () => late.peek("askAgents")?.status ?? null,
  });
  late.set("setupAssistant", setupAssistant);
  services.add("setup assistant", () => setupAssistant.close());
  // Auto appearance: Dark Mode by the time of day, when appearance.auto is on (appearance/auto.ts).
  const autoAppearance = new AutoAppearance({ flags: switches.flags, enabled: () => settingsStore.getSnapshot().data.appearance.auto === true });
  const stopAutoAppearance = autoAppearance.start();
  const stopFollowingAuto = settingsStore.subscribe(() => autoAppearance.tick());
  services.add("auto appearance", () => {
    stopFollowingAuto();
    stopAutoAppearance();
  });
  return { settingsApp, setupAssistant };
}
