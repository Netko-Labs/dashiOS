/**
 * The Setup Assistant, opened from the shell like System Settings: one
 * window (asking again brings it forward), first thing at a person's first
 * login, and again whenever they ask (Settings > About, the launcher, an
 * agent). It runs inside the shell process, so its pages use the shell's own
 * stores directly. Only Done and Skip Setup (which asks first) are
 * remembered: closing the window before the end is not skipping, so the
 * assistant comes back at the next login until one of the two is chosen. A
 * person who finished once is not marked as having skipped by looking again.
 */

import type { AnswerStatus } from "../agents/ask/service.ts";
import { registerShellApp, SETUP_APP_ID } from "../apps.ts";
import type { Compositor } from "../compositor.ts";
import { type OverlayHandle, openOverlay } from "../overlay.tsx";
import type { RegionStore } from "../region/store.ts";
import { loadLayouts } from "../settings-app/layouts.ts";
import type { SettingsStore } from "../settings-app/store.ts";
import type { FlagsStore } from "../shared/control-center/flags.ts";
import { Software } from "../shared/software/manager.ts";
import { standIn } from "../shared/software/stand-in.ts";
import { isDevelopmentRun } from "../system/stand-in.ts";
import type { SystemStore } from "../system/store.ts";
import { PasswordPrompt } from "../wifi/prompt.tsx";
import type { WifiStore } from "../wifi/store.ts";
import type { SetupContext } from "./context.ts";
import { detectHardware } from "./extras/hardware.ts";
import { hasHelper, helperRunner, isDryRun } from "./extras/helper.ts";
import { ExtrasStore } from "./extras/store.ts";
import { Flow, type Machine, type PageId } from "./flow.ts";
import { isLiveBoot } from "./live.ts";
import { readSetupRecord, type SetupOutcome, setupStatePath, shouldOpenAtLogin, writeSetupRecord } from "./state.ts";
import { SETUP_WINDOW, SetupWindow } from "./view.tsx";

export const SETUP_TITLE = "Setup Assistant";

export interface SetupAssistant {
  /** Opens the window, or brings it forward when it is open; `page` also moves it to that page. */
  open(page?: PageId): void;
  /** Whether the window is up. */
  isOpen(): boolean;
  /** Opens the window if this is the person's first login (state.ts says). */
  openAtLogin(): boolean;
  close(): void;
}

export interface SetupOptions {
  /** Null without dashi-comp: the window opens, but cannot be found to raise. */
  compositor: Compositor | null;
  settings: SettingsStore;
  region: RegionStore;
  flags: FlagsStore;
  wifi: WifiStore;
  system: Pick<SystemStore, "subscribe" | "getSnapshot">;
  /** Opens the launcher: the Done page teaches ❖ with a Try it. */
  openLauncher?: () => void;
  /** Who can answer the launcher (the Agents page lists the harnesses installed); read when the window opens. */
  answers?: () => AnswerStatus | null;
  /** Where "done" is remembered; `$XDG_STATE_HOME/dashi/setup.json` unless a test says otherwise. */
  statePath?: string;
  env?: Readonly<Record<string, string | undefined>>;
}

/** The answers, when the session has them. */
function answersOf(options: SetupOptions): { answers?: AnswerStatus } {
  const answers = options.answers?.();
  return answers ? { answers } : {};
}

interface Session {
  surface: OverlayHandle | null;
  flow: Flow;
  stop: () => void;
}

/** What the machine has, from the Wi-Fi store and the network the menu bar shows; `extras`, whether optional software may be offered. */
export function machineOf(wifi: Pick<WifiStore, "getSnapshot">, system: Pick<SystemStore, "getSnapshot">, extras: boolean): Machine {
  return { wifi: wifi.getSnapshot().available !== false, wired: system.getSnapshot().network?.kind === "wired", extras };
}

export function startSetupAssistant(options: SetupOptions): SetupAssistant {
  const { compositor } = options;
  const statePath = options.statePath ?? setupStatePath();
  let session: Session | null = null;
  // The shell going away closes the window too; that is not the person's answer.
  let shuttingDown = false;
  // The live session installs nothing (it is gone at the next restart), and
  // without the helper (a checkout run) there is nothing to install with.
  const env = options.env ?? process.env;
  // A development run only ever pretends (it must not reach this machine's pkexec).
  const dryRun = isDryRun(env) || isDevelopmentRun(env);
  const offersExtras = !isLiveBoot() && hasHelper(dryRun);
  // One for the assistant's life: an install started here goes on if the window closes, and shows again when it opens.
  let extras: ExtrasStore | null = null;
  const extrasStore = (): ExtrasStore => {
    extras ??= new ExtrasStore({ detect: detectHardware, runHelper: helperRunner(dryRun), software: new Software(standIn() ?? {}) });
    return extras;
  };

  const close = (): void => {
    const current = session;
    if (!current) return;
    session = null;
    current.stop();
    current.surface?.close();
  };

  /** Raises the window: the compositor lists it by app id, and `focus` brings a minimized one back too. */
  const raise = async (): Promise<void> => {
    try {
      const window = (await compositor?.windows())?.find((candidate) => candidate.appId === SETUP_APP_ID);
      if (window) await compositor?.request("focus", { window: window.id });
    } catch (error) {
      console.error("dashi-shell: could not bring the Setup Assistant forward:", error);
    }
  };

  const remember = (outcome: SetupOutcome): void => {
    // Finishing is always written; skipping never replaces an earlier record.
    if (outcome === "finished" || readSetupRecord(statePath) === null) writeSetupRecord(outcome, statePath);
  };

  const open = (page?: PageId): void => {
    if (session) {
      if (page) session.flow.goto(page);
      void raise();
      return;
    }
    const flow = new Flow(machineOf(options.wifi, options.system, offersExtras), page ?? "welcome");
    const follow = (): void => flow.setMachine(machineOf(options.wifi, options.system, offersExtras));
    // Opened again while (or after) it installed: the Installing page is still there to see.
    if (extrasStore().getSnapshot().run.phase !== "idle") flow.setInstalling(true);
    const stops = [options.wifi.subscribe(follow), options.system.subscribe(follow)];
    // The Wi-Fi page needs to know whether there is a radio before it comes up.
    void options.wifi.refresh();
    const passwords = new PasswordPrompt(openOverlay, options.wifi);
    // Set by Done or Skip Setup; a window that just went (its close button, or
    // its host gone with the session) has none.
    let outcome: SetupOutcome | null = null;
    const current: Session = {
      surface: null,
      flow,
      stop: () => {
        for (const stop of stops) stop();
        passwords.close();
      },
    };
    session = current;
    const ctx: SetupContext = {
      settings: options.settings,
      region: options.region,
      flags: options.flags,
      wifi: options.wifi,
      layouts: loadLayouts(),
      flow,
      extras: extrasStore(),
      askPassword: (network) => passwords.ask(network),
      finish: (how) => {
        outcome = how;
        close();
      },
      ...(options.openLauncher ? { openLauncher: options.openLauncher } : {}),
      ...answersOf(options),
    };
    const stopWatching = options.settings.watch();
    stops.push(stopWatching);
    current.surface = openOverlay(
      { title: SETUP_TITLE, appId: SETUP_APP_ID, width: SETUP_WINDOW.width, height: SETUP_WINDOW.height, titleBar: "unified" },
      <SetupWindow ctx={ctx} />,
      () => {
        // The window went (Done, Skip Setup, its close button, or its host died).
        // Only Done and Skip Setup are the person's word; a closed window
        // remembers nothing, so setup is offered again at the next login.
        if (outcome && !shuttingDown) remember(outcome);
        if (session === current) session = null;
        current.stop();
      },
    );
  };

  const unregister = registerShellApp(SETUP_APP_ID, () => open());

  return {
    open,
    isOpen: () => session !== null,
    openAtLogin() {
      if (!shouldOpenAtLogin(options.env ?? process.env, readSetupRecord(statePath))) return false;
      open();
      return true;
    },
    close() {
      shuttingDown = true;
      unregister();
      close();
    },
  };
}
