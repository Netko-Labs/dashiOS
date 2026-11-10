/**
 * The laptop, started: dashi-hardware and tuned-ppd behind the power mode
 * (power/modes/), battery health (charge.ts), the keyboard light and the
 * laptop's own keys (hotkeys.ts) with the on-screen display, saved tuning at
 * login and after waking (tuning.ts), and the graphics card (graphics/).
 * The menu bar, Control Center and Settings read the stores this returns.
 *
 * A development run reads the machine and writes nothing to it: the helper,
 * tuned-ppd and cardwire are each wrapped so their writes stay in memory.
 */

import { readFileSync } from "node:fs";
import type { Compositor, CompositorWindow } from "../compositor.ts";
import { cardwireClient, type GraphicsBackend, shadowGraphics } from "../graphics/cardwire.ts";
import { GraphicsController } from "../graphics/controller.ts";
import type { LostCardStart } from "../graphics/lost-start.ts";
import { graphicsNoticePlace } from "../graphics/notice-place.ts";
import { type HardwareApi, hardwareClient, shadowHardware } from "../hardware/client.ts";
import { detectLaptop } from "../hardware/laptop.ts";
import { idleKeymap, setMachineRules } from "../keymap-state.ts";
import type { NotificationStore } from "../notifications/index.ts";
import type { PowerSource } from "../power/modes/automatic.ts";
import { parseRecipes } from "../power/modes/recipes.ts";
import type { GraphicsChoice, PowerSection } from "../power/modes/settings.ts";
import { ModeStore } from "../power/modes/store.ts";
import { MODE_LABEL } from "../power/modes/types.ts";
import type { SettingsStore } from "../settings-app/store.ts";
import { parseStat } from "../shared/processes/kernel.ts";
import type { Battery } from "../system/battery.ts";
import type { OsdController } from "../system/osd-state.ts";
import { powerProfiles, shadowProfiles } from "../system/profiles.ts";
import type { SystemStore } from "../system/store.ts";
import { hardwareBus, systemBus } from "../system/system-bus.ts";
import { ChargeKeeper } from "./charge.ts";
import { keyboardLights, laptopKeyRules, machineKeyHandler } from "./hotkeys.ts";
import type { LaptopAction } from "./menu.ts";
import { keyboardLight, LaptopStore } from "./store.ts";
import { followWake } from "./tuning.ts";

export interface LaptopOptions {
  compositor: Compositor | null;
  settings: SettingsStore;
  system: { store: SystemStore; osd: OsdController; hardware: { setMachineKeys(run: ((name: string) => Promise<boolean>) | null): void } };
  notifications: NotificationStore;
  /** Writes go nowhere (system/stand-in.ts). */
  developmentRun: boolean;
  /** Logind's sleep signal and the boot guard need the machine to be the session's own (power/nested.ts). */
  realSession: boolean;
  lostCard: LostCardStart;
  /** What the person calls a window's app (the Dock's names). */
  nameOf(window: CompositorWindow): string;
  /** Opens a Settings pane (the ROG key, a graphics notice's Graphics Settings…). */
  openSettings(pane: "battery" | "graphics"): void;
  /** The built-in screen's rate for this power source, when Automatic moves it with the cable ("60 Hz"); else null. */
  refreshRate?(plugged: boolean): string | null;
  confirmRestart(): void;
}

export interface Laptop {
  store: LaptopStore;
  modes: ModeStore;
  graphics: GraphicsController;
  run(action: LaptopAction): void;
  /** The keyboard light to `level` (0 is off). */
  setLight(level: number): void;
  close(): void;
}

const powerSourceOf = (battery: Battery | null): PowerSource =>
  battery ? { plugged: battery.state !== "discharging", percent: battery.percent } : { plugged: true, percent: null };

/**
 * Which apps hold the graphics card, by process: a window's app, or the
 * app a helper process belongs to (its parent's window). Refreshed on a
 * timer and before the card is read.
 */
function cardHolders(
  compositor: Compositor | null,
  nameOf: (window: CompositorWindow) => string,
): { refresh(): Promise<void>; appOf(pid: number): string | null } {
  let windowApps = new Map<number, string>();
  const refresh = async () => {
    const windows = compositor ? await compositor.windows().catch(() => []) : [];
    windowApps = new Map(windows.flatMap((window) => (window.pid === null ? [] : [[window.pid, nameOf(window)] as const])));
  };
  const appOf = (pid: number): string | null => {
    let at = pid;
    for (let depth = 0; depth < 8 && at > 1; depth++) {
      const name = windowApps.get(at);
      if (name) return name;
      let stat: string;
      try {
        stat = readFileSync(`/proc/${at}/stat`, "utf8");
      } catch {
        return null;
      }
      const parsed = parseStat(stat);
      if (!parsed) return null;
      at = parsed.ppid;
    }
    return null;
  };
  return { refresh, appOf };
}

/**
 * The graphics card: its controller, the notices about it, and the two
 * subscriptions (a lost card, the compositor's card events) it needs. The
 * caller starts the controller once the holders are known.
 */
function startGraphics(
  options: LaptopOptions,
  parts: {
    settings: SettingsStore;
    notifications: NotificationStore;
    compositor: Compositor | null;
    choice: () => GraphicsChoice;
    appOf(pid: number): string | null;
  },
) {
  const { settings, compositor } = parts;
  const backendReal: GraphicsBackend | null = options.lostCard.card ? cardwireClient(systemBus()) : null;
  const backend = backendReal && options.developmentRun ? shadowGraphics(backendReal) : backendReal;
  // Graphics notices have one place: the waiting notice, then the switch's, each replacing the last (graphics/notice-place.ts).
  const noticePlace = graphicsNoticePlace(parts.notifications, {
    keepHybrid: () => graphics.keepHybrid(),
    openSettings: () => options.openSettings("graphics"),
  });
  const graphics = new GraphicsController({
    card: options.lostCard.card,
    backend,
    choice: parts.choice,
    saveChoice: (choice) => settings.patch("graphics", { mode: choice === "automatic" ? undefined : choice }),
    appOf: parts.appOf,
    ...noticePlace.deps,
    rate: (plugged) => options.refreshRate?.(plugged) ?? null,
  });
  const stopLost = options.lostCard.watch?.onLost((loss) => graphics.setLost(loss)) ?? (() => {});
  // dashi-comp opened the card or let it sleep: who holds it, and whether it is awake, changed.
  const stopGpus =
    compositor?.on((event) => {
      if (event.event === "gpus-changed") void graphics.refresh();
    }) ?? (() => {});
  if (options.lostCard.watch?.lost) graphics.setLost(options.lostCard.watch.lost);
  return { graphics, noticePlace, stopLost, stopGpus };
}

/** dashi-hardware's machine: what the laptop is, its knobs and hotkeys, read again on each change. */
async function describeMachine(parts: {
  hardware: HardwareApi;
  store: LaptopStore;
  modes: ModeStore;
  charge: ChargeKeeper;
  compositor: Compositor | null;
}): Promise<void> {
  const { hardware, store, modes, charge, compositor } = parts;
  const machine = await hardware.describe().catch(() => null);
  store.setMachine(machine, detectLaptop());
  modes.setMachine(machine ? { knobs: machine.knobs, recipes: parseRecipes(machine.recipes) } : null);
  const light = keyboardLight(store.getSnapshot());
  const rules = laptopKeyRules(machine?.hotkeys ?? {}, light !== null);
  setMachineRules(rules);
  if (compositor && rules.length > 0) compositor.keymap(idleKeymap()).catch(() => {});
  void charge.check();
}

/** The power source drives Automatic, the columns, the charge, and the graphics policy; the settings are followed too. Returns the way to stop. */
function followPower(parts: {
  system: LaptopOptions["system"];
  settings: SettingsStore;
  modes: ModeStore;
  charge: ChargeKeeper;
  graphics: GraphicsController;
}): () => void {
  const { system, settings, modes, charge, graphics } = parts;
  const followSource = () => {
    const source = powerSourceOf(system.store.getSnapshot().battery);
    modes.setPowerSource(source);
    charge.setPowerSource(source);
    graphics.setPlugged(source.plugged);
  };
  const stopPower = system.store.subscribe(followSource);
  followSource();
  const stopSettings = settings.subscribe(() => {
    modes.settingsChanged();
    graphics.settingsChanged();
    void charge.check();
  });
  return () => {
    stopPower();
    stopSettings();
  };
}

/** tuned-ppd's modes, now and as they change. Returns the way to stop. */
function followProfiles(profiles: ReturnType<typeof powerProfiles>, modes: ModeStore): () => void {
  void profiles.read().then((read) => modes.setProfiles(read?.available ?? null, read?.active ?? null));
  return profiles.watch((read) => modes.setProfiles(read?.available ?? null, read?.active ?? null));
}

/** What the laptop's menus ask of it (menu.ts): a mode, a full charge, a holder to quit, a restart. */
function carryOut(action: LaptopAction, parts: { modes: ModeStore; settings: SettingsStore; graphics: GraphicsController; confirmRestart(): void }): void {
  switch (action.kind) {
    case "mode":
      parts.modes.choose(action.choice);
      return;
    case "full-charge":
      parts.settings.patch("power", { fullChargeOnce: true });
      return;
    case "quit-holder":
      parts.graphics.quit(action.name);
      return;
    case "restart":
      parts.confirmRestart();
      return;
  }
}

export function startLaptop(options: LaptopOptions): Laptop {
  const { settings, system, notifications, compositor } = options;
  const real: HardwareApi = hardwareClient(hardwareBus());
  const hardware = options.developmentRun ? shadowHardware(real) : real;
  const profilesReal = powerProfiles(systemBus());
  const profiles = options.developmentRun ? shadowProfiles(profilesReal) : profilesReal;
  const power = (): PowerSection => settings.getSnapshot().data.power;
  const graphicsChoice = (): GraphicsChoice => settings.getSnapshot().data.graphics.mode ?? "automatic";

  const store = new LaptopStore(hardware);
  const modes = new ModeStore({
    profiles,
    hardware,
    settings: power,
    saveChoice: (choice) => settings.patch("power", { mode: choice === "automatic" ? undefined : choice }),
    announce: (mode) => system.osd.show({ kind: "mode", mode, label: MODE_LABEL[mode] }),
  });
  const charge = new ChargeKeeper({ laptop: store, settings: power, endFullCharge: () => settings.patch("power", { fullChargeOnce: undefined }) });

  const holders = cardHolders(compositor, options.nameOf);
  const { graphics, noticePlace, stopLost, stopGpus } = startGraphics(options, {
    settings,
    notifications,
    compositor,
    choice: graphicsChoice,
    appOf: holders.appOf,
  });

  const stopPower = followPower({ system, settings, modes, charge, graphics });
  const stopProfiles = followProfiles(profiles, modes);

  // dashi-hardware: describe, then follow its changes.
  const describe = () => describeMachine({ hardware, store, modes, charge, compositor });
  const stopChanged = hardware.onChanged((knob, value) => {
    if (knob === "") {
      void describe();
      return;
    }
    store.knobChanged(knob, value);
    modes.knobChanged(knob, value);
    void charge.check();
  });
  void describe();
  const stopCharge = charge.start();

  const { setLight, stepLight } = keyboardLights(store, system.osd);
  system.hardware.setMachineKeys(machineKeyHandler({ modes, stepLight, openSettings: options.openSettings }));

  const stopWake = followWake(options, { hardware, notifications, modes, graphics });

  void holders.refresh().then(() => graphics.start());
  const windowsTimer = setInterval(() => void holders.refresh(), 15_000);

  return {
    store,
    modes,
    graphics,
    setLight,
    run(action) {
      carryOut(action, { modes, settings, graphics, confirmRestart: () => options.confirmRestart() });
    },
    close() {
      clearInterval(windowsTimer);
      noticePlace.close();
      stopLost();
      stopGpus();
      stopPower();
      stopProfiles();
      stopChanged();
      stopCharge();
      system.hardware.setMachineKeys(null);
      graphics.close();
      stopWake();
    },
  };
}
