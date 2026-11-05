/**
 * cardwire (packaged as dashi-graphics), over the system bus. It hides a GPU
 * with eBPF LSM hooks (apps opening it get ENOENT) instead of unbinding it,
 * so switching needs no logout. Read from its source
 * (github.com/OpenGamingCollective/cardwire, crates/cardwire-dbus and
 * crates/cardwire-daemon/src/interface), at the time of writing:
 *
 *   name   org.opengamingcollective.cardwire
 *   /org/opengamingcollective/cardwire
 *     org.opengamingcollective.cardwire.Mode   property Mode (u: 0 Integrated,
 *       1 Hybrid, 2 Manual, 3 Smart), AvailableModes() → au
 *     org.opengamingcollective.cardwire.SmartPolicy
 *       GetAppPolicies() → a{s(sasasu)}: app id → (name, desktop file id?,
 *       icon?, policy 0 blocked, 1 allowed, 2 forced)
 *     org.freedesktop.DBus.ObjectManager   GetManagedObjects()
 *   /org/opengamingcollective/cardwire/Gpu/<id>
 *     org.opengamingcollective.cardwire.Gpu   GetDevice() →
 *       (s name, s pci, u render, u card, b default, u type, s vendor,
 *       s driver, a{sv}); PowerState() → s; Lsof() → a{sas} (device node →
 *       process names); property Block (b); signal PowerStateChanged(s)
 *
 * cardwire is young and says its API may break: everything it says is
 * parsed leniently, and anything unexpected reads as "no cardwire". This one
 * file is all Dashi knows of it.
 */

import { type BusLike, getAllProperties, onPropertiesChanged, setProperty, unwrap } from "../dbus/properties.ts";
import { variant } from "../dbus/variant.ts";

export const CARDWIRE = "org.opengamingcollective.cardwire";
const ROOT = "/org/opengamingcollective/cardwire";
const MODE = `${CARDWIRE}.Mode`;
const GPU = `${CARDWIRE}.Gpu`;
const SMART = `${CARDWIRE}.SmartPolicy`;
const CONFIG = `${CARDWIRE}.Config`;
/** cardwire's own switching, which would fight Dashi's Automatic policy (policy.ts): Dashi is the one decider. */
const OWN_SWITCHES = ["BatteryAutoSwitch", "ExternalDisplayAutoSwitch"] as const;

export type CardwireMode = "integrated" | "hybrid" | "manual" | "smart";
const MODE_CODES: readonly CardwireMode[] = ["integrated", "hybrid", "manual", "smart"];

export const modeOfCode = (code: unknown): CardwireMode | null => (typeof code === "number" && Number.isInteger(code) ? (MODE_CODES[code] ?? null) : null);
export const codeOfMode = (mode: CardwireMode): number => MODE_CODES.indexOf(mode);

export interface CardwireGpu {
  path: string;
  name: string;
  pci: string;
  card: number;
  /** The GPU the screens use (cardwire never blocks it). */
  isDefault: boolean;
  /** 0 integrated, 1 discrete, … as cardwire numbers them. */
  discrete: boolean;
  driver: string;
}

export interface AppPolicy {
  id: string;
  name: string;
  allowed: boolean;
}

/** `GetDevice()`'s struct (arrives as an array); null when it isn't one. */
export function parseGpuDevice(path: string, raw: unknown): CardwireGpu | null {
  if (!Array.isArray(raw) || raw.length < 8) return null;
  const [name, pci, , card, isDefault, type, , driver] = raw;
  if (typeof name !== "string" || typeof pci !== "string" || typeof card !== "number") return null;
  return { path, name, pci, card, isDefault: isDefault === true, discrete: type === 1, driver: typeof driver === "string" ? driver : "" };
}

/** `Lsof()`'s map of device node → process names, flattened to the distinct names. */
export function parseLsof(raw: unknown): string[] {
  if (!(raw instanceof Map)) return [];
  const names = new Set<string>();
  for (const [, list] of raw) {
    if (Array.isArray(list)) for (const name of list) if (typeof name === "string" && name.length > 0 && name.length <= 64) names.add(name);
  }
  return [...names];
}

/** `GetAppPolicies()`: each app's (name, desktop id, icon, policy). */
export function parsePolicies(raw: unknown): AppPolicy[] {
  if (!(raw instanceof Map)) return [];
  const out: AppPolicy[] = [];
  for (const [id, entry] of raw) {
    if (typeof id !== "string" || !Array.isArray(entry)) continue;
    const name = typeof entry[0] === "string" && entry[0] ? entry[0] : id;
    const policy = entry.at(-1);
    out.push({ id, name, allowed: policy === 1 || policy === 2 });
  }
  return out;
}

export interface GraphicsBackend {
  /** Null without cardwire. */
  mode(): Promise<CardwireMode | null>;
  setMode(mode: CardwireMode): Promise<boolean>;
  gpus(): Promise<CardwireGpu[]>;
  /** The names of the processes holding `gpu` open. */
  holders(gpu: CardwireGpu): Promise<string[]>;
  /** The apps allowed on the card in Smart mode. */
  allowed(): Promise<AppPolicy[]>;
  /** The mode changed (another tool, cardwire's own switches). */
  onModeChanged(listener: (mode: CardwireMode | null) => void): () => void;
  /** Turns cardwire's own battery and external-screen switching off, so only Dashi decides. */
  takeOver(): Promise<void>;
}

export interface CardwireBus {
  bus(): Promise<BusLike>;
  onConnect(setup: (bus: BusLike) => Promise<void> | void): () => void;
}

export function cardwireClient(link: CardwireBus): GraphicsBackend {
  const call = async (path: string, iface: string, member: string): Promise<unknown[] | null> => {
    try {
      return await (await link.bus()).call({ destination: CARDWIRE, path, interface: iface, member });
    } catch {
      return null;
    }
  };
  const listeners = new Set<(mode: CardwireMode | null) => void>();
  let watching = false;
  return {
    mode: async () => {
      const properties = await getAllProperties(await link.bus(), { destination: CARDWIRE, path: ROOT, interface: MODE }).catch(() => null);
      return modeOfCode(properties?.get("Mode"));
    },
    setMode: async (mode) => {
      try {
        await setProperty(await link.bus(), { destination: CARDWIRE, path: ROOT, interface: MODE }, "Mode", variant("u", codeOfMode(mode)));
        return true;
      } catch {
        return false;
      }
    },
    gpus: async () => {
      const reply = await call(ROOT, "org.freedesktop.DBus.ObjectManager", "GetManagedObjects");
      const objects = reply?.[0];
      if (!(objects instanceof Map)) return [];
      const paths = [...objects].flatMap(([path, interfaces]) => (typeof path === "string" && interfaces instanceof Map && interfaces.has(GPU) ? [path] : []));
      const devices = await Promise.all(paths.map(async (path) => parseGpuDevice(path, (await call(path, GPU, "GetDevice"))?.[0])));
      return devices.filter((device): device is CardwireGpu => device !== null);
    },
    holders: async (gpu) => parseLsof((await call(gpu.path, GPU, "Lsof"))?.[0]),
    allowed: async () => parsePolicies((await call(ROOT, SMART, "GetAppPolicies"))?.[0]).filter((policy) => policy.allowed),
    takeOver: async () => {
      const bus = await link.bus().catch(() => null);
      if (!bus) return;
      const where = { destination: CARDWIRE, path: ROOT, interface: CONFIG };
      const config = await getAllProperties(bus, where).catch(() => null);
      for (const name of OWN_SWITCHES) {
        if (config?.get(name) !== true) continue;
        await setProperty(bus, where, name, variant("b", false)).catch(() => {});
      }
    },
    onModeChanged: (listener) => {
      listeners.add(listener);
      if (!watching) {
        watching = true;
        link.onConnect((bus) =>
          onPropertiesChanged(bus, { destination: CARDWIRE, path: ROOT, interface: MODE }, (changed) => {
            if (!changed.has("Mode")) return;
            const mode = modeOfCode(unwrap(changed.get("Mode")));
            for (const each of [...listeners]) each(mode);
          }).then(() => {}),
        );
      }
      return () => listeners.delete(listener);
    },
  };
}

/** Reads cardwire but keeps the mode in memory (a development run doesn't switch the host's GPUs). */
export function shadowGraphics(real: GraphicsBackend): GraphicsBackend {
  let told: CardwireMode | null = null;
  return {
    ...real,
    mode: async () => {
      const mode = await real.mode();
      return mode === null ? null : (told ?? mode);
    },
    setMode: async (mode) => {
      told = mode;
      return true;
    },
    // A development run leaves the host's cardwire configuration alone.
    takeOver: async () => {},
  };
}
