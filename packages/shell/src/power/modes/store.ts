/**
 * The one power mode (docs/0.4.0.html, "ASUS power states in sync"). Three
 * ways land here: the person picks (the battery menu, Control Center,
 * Settings, or an applet with `power.mode`, applets/power.ts), Automatic's rule fires (the power source, the battery), or the
 * firmware changes behind Dashi's back (Fn F5 cycles the platform profile;
 * dashi-hardware's `Changed` says so, and so does tuned-ppd's ActiveProfile
 * when another program sets it). Whatever the way, the store works out the
 * mode and the column and applies the recipe in one step: tuned-ppd's
 * profile first, then the knobs through dashi-hardware's `SetMany`. (The
 * screen's refresh rate is Displays' Automatic, display-config/auto-refresh.ts.)
 *
 * Both ways without loops: Dashi's own writes come back as echoes, which the
 * guard (guard.ts) recognizes and drops; a change that matches the mode in
 * effect pulls nothing; only a real change from outside moves the mode, and
 * it moves it once.
 */

import { useSyncExternalStore } from "react";
import type { HardwareApi } from "../../hardware/client.ts";
import type { Knob, KnobValue } from "../../hardware/describe.ts";
import { isProfileId, type ProfileId, type ProfileSource } from "../../system/profiles.ts";
import { type Effective, effectiveMode, type PowerSource } from "./automatic.ts";
import { EchoGuard } from "./guard.ts";
import { resolveRecipe } from "./recipes.ts";
import type { PowerSection } from "./settings.ts";
import { MODE_PROFILE, MODES, type Mode, type ModeChoice, modeOfProfile, nextMode, type Recipes } from "./types.ts";

/** The platform profile's value as a mode; the helper reports asus-wmi's `quiet` as `low-power` already. */
export function modeOfPlatformProfile(value: string): Mode | null {
  if (value === "low-power" || value === "quiet" || value === "cool") return "low-power";
  if (value === "balanced") return "balanced";
  if (value === "performance") return "performance";
  return null;
}

export interface ModeSnapshot {
  /** The modes this machine has; empty without tuned-ppd and the helper (no mode row anywhere). */
  available: readonly Mode[];
  choice: ModeChoice;
  /** Null until the power source is known. */
  effective: Effective | null;
  /** The last apply failed. */
  failed: boolean;
}

export interface ModeDeps {
  profiles: ProfileSource | null;
  hardware: HardwareApi | null;
  /** The settings' power section now. */
  settings(): PowerSection;
  /** Saves a manual pick (or "automatic") as power.mode. */
  saveChoice(choice: ModeChoice): void;
  /** A mode changed by a key or the firmware: the on-screen display. */
  announce?(mode: Mode): void;
  now?(): number;
}

export interface MachineModes {
  knobs: ReadonlyMap<string, Knob>;
  recipes: Recipes;
}

export class ModeStore {
  private snapshot: ModeSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly guard: EchoGuard;
  private machine: MachineModes | null = null;
  private profileModes: readonly Mode[] = [];
  private profileActive: ProfileId | null = null;
  private source: PowerSource | null = null;
  /** A key press holding a mode while Automatic is chosen. */
  private held: Mode | null = null;
  private applied: string | null = null;
  private applying: Promise<void> | null = null;
  private again = false;

  constructor(private readonly deps: ModeDeps) {
    this.guard = new EchoGuard(deps.now);
    this.snapshot = { available: [], choice: deps.settings().mode ?? "automatic", effective: null, failed: false };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ModeSnapshot => this.snapshot;

  /** dashi-hardware's knobs and recipes; null without the helper. */
  setMachine(machine: MachineModes | null): void {
    this.machine = machine;
    this.sync();
  }

  /** tuned-ppd's modes as read or watched; null without it. */
  setProfiles(available: readonly ProfileId[] | null, active: ProfileId | null): void {
    this.profileModes = (available ?? []).map(modeOfProfile);
    const was = this.profileActive;
    this.profileActive = active;
    if (active !== null && was !== null && active !== was) this.external("profile", active);
    else this.sync();
  }

  setPowerSource(source: PowerSource): void {
    const cable = this.source !== null && this.source.plugged !== source.plugged;
    this.source = source;
    // The cable switches columns; a key press's hold lasts until then.
    if (cable) this.held = null;
    this.sync();
  }

  /** The settings file changed (Settings, a hand edit). */
  settingsChanged(): void {
    const choice = this.deps.settings().mode ?? "automatic";
    if (choice !== this.snapshot.choice) this.held = null;
    this.publish({ choice });
    this.sync();
  }

  /** The person picked (menu, Control Center, Settings). */
  choose(choice: ModeChoice): void {
    this.held = null;
    this.deps.saveChoice(choice);
    this.publish({ choice });
    this.sync();
  }

  /** The mode key arrived as a key (models whose firmware doesn't cycle the profile itself), or the tile's click: the next mode. */
  cycle(): void {
    const current = this.snapshot.effective?.mode ?? "balanced";
    const modes = this.availableModes();
    let next = nextMode(current);
    while (!modes.includes(next) && next !== current) next = nextMode(next);
    this.pressed(next);
  }

  /** dashi-hardware said a knob changed. */
  knobChanged(knob: string, value: KnobValue | null): void {
    const known = this.machine?.knobs.get(knob);
    if (this.machine && known && value !== null) {
      const knobs = new Map(this.machine.knobs);
      knobs.set(knob, { ...known, value });
      this.machine = { ...this.machine, knobs };
    }
    if (knob === "platform-profile" && typeof value === "string") this.external("platform-profile", value);
  }

  /** Applies the recipe again even if nothing changed (after waking: firmware can forget). */
  reapply(): Promise<void> {
    this.applied = null;
    this.sync();
    return this.applying ?? Promise.resolve();
  }

  /** Resolves when no apply is running. */
  async idle(): Promise<void> {
    while (this.applying) await this.applying;
  }

  private external(kind: "platform-profile" | "profile", value: string): void {
    if (this.guard.isEcho(kind, value)) return;
    const effective = this.snapshot.effective;
    if (kind === "profile") {
      const mode = isProfileId(value) ? modeOfProfile(value) : null;
      // tuned-ppd following the firmware, or Dashi: nothing to pull.
      if (mode !== null && mode !== effective?.mode) this.pressed(mode);
      return;
    }
    const mode = modeOfPlatformProfile(value);
    if (mode === null || !effective) return;
    // The profile the recipe in effect writes (a mode's battery column may use a lower one): in sync.
    if (value === this.recipeFor(effective)?.knobs["platform-profile"]) return;
    // The firmware moved off the recipe: the key was pressed. Landing on the mode in effect
    // (its column uses another profile) still means "the next one".
    this.pressed(mode === effective.mode ? nextMode(mode) : mode);
  }

  private recipeFor(effective: Effective) {
    return this.machine ? resolveRecipe(this.machine.recipes, effective.mode, effective.column, this.machine.knobs, this.deps.settings()) : null;
  }

  private pressed(mode: Mode): void {
    if (this.snapshot.choice === "automatic") {
      this.held = mode;
    } else {
      this.deps.saveChoice(mode);
      this.publish({ choice: mode });
    }
    this.deps.announce?.(mode);
    this.sync();
  }

  private availableModes(): readonly Mode[] {
    const profile = this.machine?.knobs.get("platform-profile");
    if (profile?.choices && profile.choices.length > 0) {
      const modes = new Set(profile.choices.map(modeOfPlatformProfile).filter((mode): mode is Mode => mode !== null));
      return MODES.filter((mode) => modes.has(mode));
    }
    return this.profileModes;
  }

  private sync(): void {
    const available = this.availableModes();
    if (available.length === 0 || this.source === null) {
      this.publish({ available, effective: null });
      return;
    }
    let effective = effectiveMode(this.snapshot.choice, this.held, this.source);
    // A mode the machine lacks (High Performance without a platform profile driver) is the nearest one below.
    if (!available.includes(effective.mode)) effective = { ...effective, mode: available.includes("balanced") ? "balanced" : (available[0] as Mode) };
    this.publish({ available, effective });
    void this.apply();
  }

  private apply(): Promise<void> {
    if (this.applying) {
      this.again = true;
      return this.applying;
    }
    this.applying = (async () => {
      do {
        this.again = false;
        await this.applyOnce();
      } while (this.again);
    })().finally(() => {
      this.applying = null;
    });
    return this.applying;
  }

  private async applyOnce(): Promise<void> {
    const effective = this.snapshot.effective;
    if (!effective) return;
    const recipe = this.recipeFor(effective);
    const key = JSON.stringify([effective.mode, effective.column, recipe]);
    if (key === this.applied) return;
    this.applied = key;
    let ok = true;
    const profile = MODE_PROFILE[effective.mode];
    if (this.deps.profiles && this.profileModes.includes(effective.mode) && this.profileActive !== profile) {
      this.guard.expect("profile", profile);
      ok = (await this.deps.profiles.set(profile).catch(() => false)) && ok;
      if (ok) this.profileActive = profile;
    }
    if (this.deps.hardware && recipe && Object.keys(recipe.knobs).length > 0) {
      const platform = recipe.knobs["platform-profile"];
      if (typeof platform === "string" && this.machine?.knobs.get("platform-profile")?.value !== platform) this.guard.expect("platform-profile", platform);
      const written = await this.deps.hardware.setMany(recipe.knobs).catch(() => null);
      ok = written !== null && ok;
      if (written && this.machine) {
        const knobs = new Map(this.machine.knobs);
        for (const [name, value] of Object.entries(written)) {
          const knob = knobs.get(name);
          if (knob) knobs.set(name, { ...knob, value });
        }
        this.machine = { ...this.machine, knobs };
      }
    }
    if (!ok) this.applied = null;
    this.publish({ failed: !ok });
  }

  private publish(change: Partial<ModeSnapshot>): void {
    const next = { ...this.snapshot, ...change };
    if (JSON.stringify(next) === JSON.stringify(this.snapshot)) return;
    this.snapshot = next;
    for (const listener of [...this.listeners]) listener();
  }
}

export function useModes(store: ModeStore): ModeSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
