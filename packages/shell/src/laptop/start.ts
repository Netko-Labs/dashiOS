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
import { parseStat } from "../menus/session.ts";
import type { NotificationStore } from "../notifications/store.ts";
import { Logind } from "../power/logind.ts";
import type { PowerSource } from "../power/modes/automatic.ts";
import { parseRecipes } from "../power/modes/recipes.ts";
import type { GraphicsChoice, PowerSection } from "../power/modes/settings.ts";
import { ModeStore } from "../power/modes/store.ts";
import { MODE_LABEL } from "../power/modes/types.ts";
import type { SettingsStore } from "../settings-app/store.ts";
import type { Battery } from "../system/battery.ts";
import type { OsdController } from "../system/osd-state.ts";
import { powerProfiles, shadowProfiles } from "../system/profiles.ts";
import type { SystemStore } from "../system/store.ts";
import { hardwareBus, systemBus } from "../system/system-bus.ts";
import { ChargeKeeper } from "./charge.ts";
import { LAPTOP_BINDING_NAMES, LAPTOP_BINDINGS, LIGHT_STEP_BINDINGS, laptopKeyRules, nextLightLevel } from "./hotkeys.ts";
import type { LaptopAction } from "./menu.ts";
import { keyboardLight, LaptopStore } from "./store.ts";
import { applyTuning } from "./tuning.ts";

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

  // The apps' windows by process, for naming the card's holders (a helper process goes by its parent's window).
  let windowApps = new Map<number, string>();
  const refreshWindows = async () => {
    const windows = compositor ? await compositor.windows().catch(() => []) : [];
    windowApps = new Map(windows.flatMap((window) => (window.pid === null ? [] : [[window.pid, options.nameOf(window)] as const])));
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

  const backendReal: GraphicsBackend | null = options.lostCard.card ? cardwireClient(systemBus()) : null;
  const backend = backendReal && options.developmentRun ? shadowGraphics(backendReal) : backendReal;
  // Graphics notices have one place: the waiting notice, then the switch's, each replacing the last (graphics/notice-place.ts).
  const noticePlace = graphicsNoticePlace(notifications, {
    keepHybrid: () => graphics.keepHybrid(),
    openSettings: () => options.openSettings("graphics"),
  });
  const graphics = new GraphicsController({
    card: options.lostCard.card,
    backend,
    choice: graphicsChoice,
    saveChoice: (choice) => settings.patch("graphics", { mode: choice === "automatic" ? undefined : choice }),
    appOf,
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

  // The power source drives Automatic, the columns, the charge, and the graphics policy.
  const followPower = () => {
    const source = powerSourceOf(system.store.getSnapshot().battery);
    modes.setPowerSource(source);
    charge.setPowerSource(source);
    graphics.setPlugged(source.plugged);
  };
  const stopPower = system.store.subscribe(followPower);
  followPower();
  const stopSettings = settings.subscribe(() => {
    modes.settingsChanged();
    graphics.settingsChanged();
    void charge.check();
  });

  // tuned-ppd's modes, and its changes.
  void profiles.read().then((read) => modes.setProfiles(read?.available ?? null, read?.active ?? null));
  const stopProfiles = profiles.watch((read) => modes.setProfiles(read?.available ?? null, read?.active ?? null));

  // dashi-hardware: describe, then follow its changes.
  const describe = async () => {
    const machine = await hardware.describe().catch(() => null);
    store.setMachine(machine, detectLaptop());
    modes.setMachine(machine ? { knobs: machine.knobs, recipes: parseRecipes(machine.recipes) } : null);
    const light = keyboardLight(store.getSnapshot());
    const rules = laptopKeyRules(machine?.hotkeys ?? {}, light !== null);
    setMachineRules(rules);
    if (compositor && rules.length > 0) compositor.request("keymap", idleKeymap()).catch(() => {});
    void charge.check();
  };
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

  const setLight = (level: number) => {
    const light = keyboardLight(store.getSnapshot());
    if (!light) return;
    const next = Math.max(0, Math.min(light.max, Math.round(level)));
    void store.set("kbd-backlight", next);
  };
  const stepLight = (step: "cycle" | "up" | "down") => {
    const light = keyboardLight(store.getSnapshot());
    if (!light) return;
    const next = nextLightLevel(light.level, light.max, step);
    setLight(next);
    system.osd.show({ kind: "keyboard-light", level: next, max: light.max });
  };
  system.hardware.setMachineKeys(async (name) => {
    if (!LAPTOP_BINDING_NAMES.has(name)) return false;
    if (name === LAPTOP_BINDINGS.mode) modes.cycle();
    else if (name === LAPTOP_BINDINGS.lighting) stepLight("cycle");
    else if (name === LIGHT_STEP_BINDINGS.up) stepLight("up");
    else if (name === LIGHT_STEP_BINDINGS.down) stepLight("down");
    else if (name === LAPTOP_BINDINGS.rog) options.openSettings("battery");
    return true;
  });

  // Saved tuning at login and after waking, and the recipe again after waking (firmware forgets).
  let logind: Logind | null = null;
  if (options.realSession && !options.developmentRun) {
    void applyTuning({ hardware, notifications }, true).catch(() => {});
    void Logind.connect()
      .then(async (connected) => {
        logind = connected;
        await connected.onPrepareForSleep((sleeping) => {
          if (sleeping) return;
          void applyTuning({ hardware, notifications }, false).catch(() => {});
          void modes.reapply();
          void graphics.refresh();
        });
      })
      .catch(() => {});
  }

  void refreshWindows().then(() => graphics.start());
  const windowsTimer = setInterval(() => void refreshWindows(), 15_000);

  return {
    store,
    modes,
    graphics,
    setLight,
    run(action) {
      switch (action.kind) {
        case "mode":
          modes.choose(action.choice);
          return;
        case "full-charge":
          settings.patch("power", { fullChargeOnce: true });
          return;
        case "quit-holder":
          graphics.quit(action.name);
          return;
        case "restart":
          options.confirmRestart();
          return;
      }
    },
    close() {
      clearInterval(windowsTimer);
      noticePlace.close();
      stopLost();
      stopGpus();
      stopPower();
      stopSettings();
      stopProfiles();
      stopChanged();
      stopCharge();
      system.hardware.setMachineKeys(null);
      graphics.close();
      logind?.close();
    },
  };
}
