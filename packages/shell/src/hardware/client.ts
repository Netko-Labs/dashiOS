/**
 * The shell's side of dashi-hardware (docs/hardware.md): the privileged
 * helper on the system bus that writes what a laptop's kernel exposes. It
 * decides nothing and the shell decides everything (power/modes/), so this
 * is a thin client: `Describe`, `Get`, `Set`, `SetMany`, the tuning calls,
 * and the `Changed` signal. A machine without the helper answers null
 * everywhere, and the laptop features fall back or stay out.
 *
 * A development run reads the machine but never writes it
 * (`shadowHardware`): what it sets is kept in memory.
 */

import { isRecord } from "@dashi/shape";
import { type BusLike, unwrap, type Variant, variant } from "../shared/dbus/index.ts";
import { type KnobValue, type Machine, parseDescribe } from "./describe.ts";

export const HARDWARE = { destination: "dev.dashi.Hardware1", path: "/dev/dashi/Hardware1", interface: "dev.dashi.Hardware1" } as const;

export interface TuningResult {
  applied: boolean;
  reason: string;
}

export interface BootGuard {
  cleanBoot: boolean;
  failedBoots: number;
  /** Two failed boots in a row cleared the saved tuning. */
  reset: boolean;
}

export interface HardwareApi {
  /** Null without the helper. */
  describe(): Promise<Machine | null>;
  /** What was written (clamped), or null when it was refused. */
  set(knob: string, value: KnobValue): Promise<KnobValue | null>;
  /** One recipe in one call; what was written, or null when refused. */
  setMany(values: Readonly<Record<string, KnobValue>>): Promise<Record<string, KnobValue> | null>;
  applySavedTuning(): Promise<TuningResult | null>;
  bootGuard(): Promise<BootGuard | null>;
  /** A knob changed (by Dashi, or Fn F5 behind its back); knob "" means describe again. */
  onChanged(listener: (knob: string, value: KnobValue | null) => void): () => void;
}

/** The variant a knob's value goes in: `s`, `b`, or `u` (docs/hardware.md, Knobs). */
export function knobVariant(value: KnobValue): Variant {
  if (typeof value === "string") return variant("s", value);
  if (typeof value === "boolean") return variant("b", value);
  return variant("u", Math.max(0, Math.round(value)));
}

/** A value off the bus as a knob's; anything else is null. */
export function knobValue(raw: unknown): KnobValue | null {
  const value = unwrap(raw);
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  return null;
}

function valueMap(raw: unknown): Record<string, KnobValue> | null {
  if (!(raw instanceof Map)) return null;
  const out: Record<string, KnobValue> = {};
  for (const [name, value] of raw) {
    const parsed = knobValue(value);
    if (typeof name === "string" && parsed !== null) out[name] = parsed;
  }
  return out;
}

const jsonObject = (raw: unknown): Record<string, unknown> | null => {
  if (typeof raw !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export function parseTuning(raw: unknown): TuningResult | null {
  const json = jsonObject(raw);
  return json && typeof json.applied === "boolean" ? { applied: json.applied, reason: typeof json.reason === "string" ? json.reason : "" } : null;
}

export function parseBootGuard(raw: unknown): BootGuard | null {
  const json = jsonObject(raw);
  if (!json || typeof json.cleanBoot !== "boolean" || typeof json.reset !== "boolean") return null;
  const failed = typeof json.failedBoots === "number" && Number.isFinite(json.failedBoots) ? json.failedBoots : 0;
  return { cleanBoot: json.cleanBoot, failedBoots: failed, reset: json.reset };
}

export interface HardwareBus {
  bus(): Promise<BusLike>;
  onConnect(setup: (bus: BusLike) => Promise<void> | void): () => void;
}

/** dashi-hardware over the system bus. */
export function hardwareClient(link: HardwareBus): HardwareApi {
  const call = async (member: string, signature?: string, body?: unknown[]): Promise<unknown[] | null> => {
    try {
      const bus = await link.bus();
      // Writes may ask polkit for the password (the `tune` actions); reads never do.
      return await bus.call({
        ...HARDWARE,
        member,
        ...(signature ? { signature, body: body ?? [] } : {}),
        ...(member.startsWith("Set") ? { interactive: true } : {}),
      });
    } catch {
      return null;
    }
  };
  const listeners = new Set<(knob: string, value: KnobValue | null) => void>();
  let watching = false;
  return {
    describe: async () => {
      const reply = await call("Describe");
      return typeof reply?.[0] === "string" ? parseDescribe(reply[0]) : null;
    },
    set: async (knob, value) => {
      const reply = await call("Set", "sv", [knob, knobVariant(value)]);
      return reply ? knobValue(reply[0]) : null;
    },
    setMany: async (values) => {
      const map = new Map(Object.entries(values).map(([name, value]) => [name, knobVariant(value)]));
      const reply = await call("SetMany", "a{sv}", [map]);
      return reply ? valueMap(reply[0]) : null;
    },
    applySavedTuning: async () => parseTuning((await call("ApplySavedTuning"))?.[0]),
    bootGuard: async () => parseBootGuard((await call("BootGuard"))?.[0]),
    onChanged: (listener) => {
      listeners.add(listener);
      if (!watching) {
        watching = true;
        link.onConnect(async (bus) => {
          await bus.subscribe(
            { type: "signal", sender: HARDWARE.destination, interface: HARDWARE.interface, member: "Changed", path: HARDWARE.path },
            (message) => {
              const [knob, value] = message.body;
              if (typeof knob !== "string") return;
              const parsed = knobValue(value);
              for (const each of [...listeners]) each(knob, parsed);
            },
          );
        });
      }
      return () => listeners.delete(listener);
    },
  };
}

/** Reads the machine; keeps every write in memory (a development run must not touch the host's hardware). */
export function shadowHardware(real: HardwareApi): HardwareApi {
  const written = new Map<string, KnobValue>();
  return {
    describe: async () => {
      const machine = await real.describe();
      if (!machine) return null;
      const knobs = new Map(machine.knobs);
      for (const [name, value] of written) {
        const knob = knobs.get(name);
        if (knob) knobs.set(name, { ...knob, value });
      }
      return { ...machine, knobs };
    },
    set: async (knob, value) => {
      written.set(knob, value);
      return value;
    },
    setMany: async (values) => {
      for (const [name, value] of Object.entries(values)) written.set(name, value);
      return { ...values };
    },
    applySavedTuning: async () => ({ applied: false, reason: "development run" }),
    bootGuard: () => real.bootGuard(),
    onChanged: (listener) => real.onChanged(listener),
  };
}
