/**
 * What the laptop's controls show, apart from the power mode (power/modes/)
 * and the graphics card (graphics/): whether this is a laptop at all, the
 * knobs dashi-hardware offers with their values (the keyboard light, the
 * charge limit, the panel's overdrive, boost), and writing one. Values come
 * from `Describe()` and stay current through `Changed`.
 */

import { useSyncExternalStore } from "react";
import type { HardwareApi } from "../hardware/client.ts";
import type { Knob, KnobValue, Machine } from "../hardware/describe.ts";

export interface LaptopSnapshot {
  /** Laptop-only rows and panes show only when this is true. */
  laptop: boolean;
  /** dashi-hardware answered. */
  helper: boolean;
  model: string | null;
  knobs: ReadonlyMap<string, Knob>;
  /** The keyboard light's levels above off, null without one. */
  keyboardLevels: number | null;
}

export class LaptopStore {
  private snapshot: LaptopSnapshot = { laptop: false, helper: false, model: null, knobs: new Map(), keyboardLevels: null };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly hardware: HardwareApi | null) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): LaptopSnapshot => this.snapshot;

  setMachine(machine: Machine | null, fallbackLaptop: boolean): void {
    this.publish({
      laptop: machine?.laptop ?? fallbackLaptop,
      helper: machine !== null,
      model: machine?.model ?? null,
      knobs: machine?.knobs ?? new Map(),
      keyboardLevels: machine?.keyboardLevels ?? null,
    });
  }

  knob(name: string): Knob | undefined {
    return this.snapshot.knobs.get(name);
  }

  /** A knob's value as dashi-hardware reported it. */
  knobChanged(name: string, value: KnobValue | null): void {
    const knob = this.snapshot.knobs.get(name);
    if (!knob || value === null || knob.value === value) return;
    const knobs = new Map(this.snapshot.knobs);
    knobs.set(name, { ...knob, value });
    this.publish({ knobs });
  }

  /** Writes a knob; shows the value at once, then what the helper wrote. False when refused. */
  async set(name: string, value: KnobValue): Promise<boolean> {
    if (!this.hardware || !this.snapshot.knobs.has(name)) return false;
    const before = this.snapshot.knobs.get(name)?.value ?? null;
    this.knobChanged(name, value);
    const written = await this.hardware.set(name, value).catch(() => null);
    this.knobChanged(name, written ?? before);
    return written !== null;
  }

  private publish(change: Partial<LaptopSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of [...this.listeners]) listener();
  }
}

export function useLaptop(store: Pick<LaptopStore, "subscribe" | "getSnapshot">): LaptopSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** The keyboard light's level now (0 is off), and its top level; null without one. */
export function keyboardLight(snapshot: LaptopSnapshot): { level: number; max: number } | null {
  const knob = snapshot.knobs.get("kbd-backlight");
  const max = snapshot.keyboardLevels ?? knob?.max ?? null;
  if (!knob || max === null || max <= 0) return null;
  return { level: typeof knob.value === "number" ? knob.value : 0, max };
}

/** The keyboard light's level in words, for 3 levels as the G14 has, else "Level n". */
export function lightLabel(level: number, max: number): string {
  if (level <= 0) return "Off";
  if (max === 3) return ["Low", "Medium", "High"][level - 1] ?? `Level ${level}`;
  return level >= max ? "High" : `Level ${level}`;
}
