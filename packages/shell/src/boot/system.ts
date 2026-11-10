/**
 * The machine's state and its guards (main.tsx): Wi-Fi and Bluetooth, PipeWire,
 * the battery, network and volume, the lock screen, sleep and the power key,
 * screen sharing, the portal's grants, and polkit's password sheet.
 */

import { LockWatch } from "../agents/index.ts";
import { type BluetoothSetup, chooseBluetooth } from "../bluetooth/index.ts";
import type { Compositor } from "../compositor/index.ts";
import { LockController } from "../lock/index.ts";
import { holdingBar } from "../menubar/index.ts";
import { runPower } from "../menus/index.ts";
import { openOverlay } from "../overlay.tsx";
import { type Polkit, startPolkit } from "../polkit/index.ts";
import { type Power, startPower } from "../power/index.ts";
import { type Privacy, startPrivacy } from "../privacy/index.ts";
import { type ScreenCapture, ScreenCaptureStore, startScreenCapture } from "../screen-capture/index.ts";
import type { SettingsStore } from "../settings-app/index.ts";
import { type PipeWireWatch, pipewireWatch } from "../sound/index.ts";
import { isDevelopmentRun, type System, startSystem } from "../system/index.ts";
import { chooseWifi, type WifiSetup, WifiStore } from "../wifi/index.ts";
import { type Look, startLiveWallpaper } from "./look.ts";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";

export interface Radios {
  wifi: WifiSetup;
  /** Whether this is a development run, for what is not Wi-Fi or Bluetooth: polkit, autostart (system/stand-in.ts). */
  developmentRun: boolean;
  bluetooth: BluetoothSetup;
}

/** Wi-Fi and Bluetooth: the real ones on a real session, stand-ins on a development run, so a nested shell never touches the host's. */
export function chooseRadios(): Radios {
  // Wi-Fi: NetworkManager on a real session, a stand-in on a development run
  // (wifi/select.ts), so a nested shell never touches the host's network.
  const wifi = chooseWifi();
  const developmentRun = isDevelopmentRun(process.env);
  // Bluetooth likewise: BlueZ on a real session, a stand-in on a development run (bluetooth/select.ts).
  const bluetooth = chooseBluetooth();
  return { wifi, developmentRun, bluetooth };
}

export interface SystemStores {
  pipewire: PipeWireWatch;
  system: System;
  wifiStore: WifiStore;
}

/** PipeWire, the battery, network and volume, the live wallpaper that pauses by them, and the Wi-Fi list. */
export function startSystemStores(compositor: Compositor | null, wifi: WifiSetup, look: Look, services: Services): SystemStores {
  // PipeWire's objects: one pw-dump --monitor for the session, which the mixer, the outputs, the
  // levels, Control Center's slider and the bar's speaker all follow (sound/apps/watch.ts). It only reads.
  const pipewire = pipewireWatch();
  // Battery, network, and volume for the menu bar; the volume and brightness keys.
  const system = startSystem({ compositor, pipewire, ...(wifi.status ? { network: wifi.status, ...(wifi.monitor ? { monitor: wifi.monitor } : {}) } : {}) });
  services.add("system", () => system.close());
  startLiveWallpaper(look, compositor, system);
  // The Wi-Fi list and joins: the menu and Control Center read it, and so do agents.
  const wifiStore = new WifiStore(wifi.backend, { networkChanged: () => void system.store.refresh("network") });
  return { pipewire, system, wifiStore };
}

export interface Guards {
  lockScreen: LockController | null;
  power: Power;
  screenCapture: ScreenCaptureStore;
  capture: ScreenCapture | null;
  privacy: Privacy | null;
  polkitLock: LockWatch | null;
  /** Whether the screen is locked: as the compositor says (lock events), or a lock screen is up or on its way. */
  screenLocked: () => boolean;
  polkit: Polkit;
}

interface GuardsNeeds {
  compositor: Compositor | null;
  look: Look;
  settingsStore: SettingsStore;
  developmentRun: boolean;
  services: Services;
  late: Late<LateParts>;
}

/** The lock screen, sleep and the power key, screen sharing, the portal's grants, and polkit. */
export function startGuards({ compositor, look, settingsStore, developmentRun, services, late }: GuardsNeeds): Guards {
  // The lock screen; a session left locked by an earlier shell gets it back.
  const lockScreen = compositor ? new LockController(compositor) : null;
  void lockScreen?.resume();

  // Sleep, the lid, and the power key, through logind (power/): the screen locks
  // before the machine sleeps, `loginctl lock-session` locks it, and the power
  // key asks first. With no logind it logs once and the shell goes on.
  const power = startPower({
    compositor,
    lock: lockScreen ? () => lockScreen.lock() : null,
    confirmShutdown: () => late.get("menus").confirmPower("shutdown"),
    fallbackSuspend: () => runPower("sleep"),
  });
  services.add("power", () => power.close());
  // "Put the computer to sleep after" (Settings, Battery & Power): the idle clock's second threshold.
  if (look.idle) look.idle.onSleep = () => void power.suspend();

  const { screenCapture, capture, privacy } = startSharing(compositor, settingsStore, developmentRun, services);

  // Privileged actions apps ask for (pkexec, mounting a disk, software installs)
  // need a password sheet: polkit's authentication agent (polkit/). It stays off
  // on a development run, which never registers on the machine's system bus.
  const polkitLock = compositor ? new LockWatch(compositor) : null;
  services.add("polkit lock watch", () => polkitLock?.close());
  const screenLocked = (): boolean => (polkitLock?.isLocked ?? false) || (lockScreen?.isLocked ?? false);
  const polkit = startPolkit({
    developmentRun,
    lock: polkitLock ?? { isLocked: false, onChange: () => () => {} },
    // Its password sheet is the app in front's: the bar keeps that app (bar-hold.ts).
    open: holdingBar(openOverlay),
  });
  services.add("polkit", () => polkit.close());
  return { lockScreen, power, screenCapture, capture, privacy, polkitLock, screenLocked, polkit };
}

/** Screen sharing for the programs on the list, and what apps were allowed through the portal. */
function startSharing(
  compositor: Compositor | null,
  settingsStore: SettingsStore,
  developmentRun: boolean,
  services: Services,
): Pick<Guards, "screenCapture" | "capture" | "privacy"> {
  // Agents (MCP) run here too.
  // Screen sharing: the compositor serves the portal's captures only to the
  // programs on our list, and tells us while one is running (screen-capture.ts).
  const screenCapture = new ScreenCaptureStore();
  const capture = compositor ? startScreenCapture(compositor, screenCapture) : null;
  services.add("screen sharing", () => capture?.stop());
  // A program taken off `screenSharing.clients` (Settings › Privacy & Security) loses the protocol at once.
  let captureClients = JSON.stringify(settingsStore.getSnapshot().data.screenSharing.clients ?? []);
  const stopFollowingCaptureClients = settingsStore.subscribe(() => {
    const next = JSON.stringify(settingsStore.getSnapshot().data.screenSharing.clients ?? []);
    if (next === captureClients) return;
    captureClients = next;
    capture?.refresh();
  });
  services.add("screen sharing list", stopFollowingCaptureClients);
  // What apps were allowed through the portal, dated as they are given (privacy/; Settings › Privacy & Security).
  const privacy = developmentRun ? null : startPrivacy();
  services.add("privacy", () => privacy?.stop());
  return { screenCapture, capture, privacy };
}
