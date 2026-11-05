/**
 * Power modes through the power-profiles D-Bus API on the system bus, which
 * tuned-ppd serves (Fedora's default, required by dashi-release) and so does
 * power-profiles-daemon: Low Power (power-saver), Balanced, and High
 * Performance (performance, which not every machine has). `ActiveProfile` is
 * read and watched (`PropertiesChanged`), and set as a property. A machine
 * without either daemon has no power modes, and the panes leave the row out.
 *
 * Both of the API's names are tried, the newer one first:
 * `org.freedesktop.UPower.PowerProfiles` and the original
 * `net.hadess.PowerProfiles`.
 */

import { type BusLike, getAllProperties, onPropertiesChanged, type PropertyTarget, setProperty, unwrap } from "../dbus/properties.ts";
import { variant } from "../dbus/variant.ts";

export const PROFILE_IDS = ["power-saver", "balanced", "performance"] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

export const isProfileId = (value: unknown): value is ProfileId => PROFILE_IDS.some((id) => id === value);

/** What the pane calls each mode. */
export const PROFILE_LABEL: Record<ProfileId, string> = { "power-saver": "Low Power", balanced: "Balanced", performance: "High Performance" };

export interface Profiles {
  /** The modes this machine offers, in the order low to high. */
  available: ProfileId[];
  active: ProfileId;
}

/** The API's two names, newest first. */
export const POWER_PROFILES: readonly PropertyTarget[] = [
  { destination: "org.freedesktop.UPower.PowerProfiles", path: "/org/freedesktop/UPower/PowerProfiles", interface: "org.freedesktop.UPower.PowerProfiles" },
  { destination: "net.hadess.PowerProfiles", path: "/net/hadess/PowerProfiles", interface: "net.hadess.PowerProfiles" },
];

/** The profiles a `Profiles` property lists (`aa{sv}`, each with a `Profile` name), low to high; unknown names are left out. */
export function parseProfileNames(value: unknown): ProfileId[] | null {
  if (!Array.isArray(value)) return null;
  const found = new Set<ProfileId>();
  for (const entry of value) {
    if (!(entry instanceof Map)) continue;
    const name = unwrap(entry.get("Profile"));
    if (isProfileId(name)) found.add(name);
  }
  return PROFILE_IDS.filter((id) => found.has(id));
}

/** The daemon's properties (`GetAll`, unwrapped) as modes; null when they don't make sense. */
export function parseProfiles(properties: ReadonlyMap<string, unknown>): Profiles | null {
  const active = properties.get("ActiveProfile");
  const available = parseProfileNames(properties.get("Profiles"));
  if (!isProfileId(active) || !available || !available.includes(active)) return null;
  return { available, active };
}

/** A `PropertiesChanged` applied to what was known; a change naming a mode the machine lacks is ignored. */
export function applyChange(known: Profiles | null, changed: ReadonlyMap<string, unknown>): Profiles | null {
  const available = changed.has("Profiles") ? parseProfileNames(changed.get("Profiles")) : (known?.available ?? null);
  const active = changed.get("ActiveProfile") ?? known?.active;
  if (!available || !isProfileId(active) || !available.includes(active)) return known;
  return { available, active };
}

export interface ProfileSource {
  /** Null without the daemon. */
  read(): Promise<Profiles | null>;
  /** True when the mode is now `id`. */
  set(id: ProfileId): Promise<boolean>;
  /** Calls `listener` with the modes when another program (or the daemon) changes them; returns the way to stop. */
  watch(listener: (profiles: Profiles | null) => void): () => void;
}

/** What the source needs of the bus: a connection when asked, and a hook for each new one (dbus/link.ts). */
export interface ProfilesBus {
  bus(): Promise<BusLike>;
  onConnect(setup: (bus: BusLike) => Promise<void> | void): () => void;
}

/** The power-profiles daemon over the system bus. */
export function powerProfiles(link: ProfilesBus, targets: readonly PropertyTarget[] = POWER_PROFILES): ProfileSource {
  let known: Profiles | null = null;
  let found: PropertyTarget | null = null;
  const listeners = new Set<(profiles: Profiles | null) => void>();

  const read = async (): Promise<Profiles | null> => {
    const bus = await link.bus().catch(() => null);
    if (!bus) return null;
    for (const target of found ? [found, ...targets.filter((t) => t !== found)] : targets) {
      const properties = await getAllProperties(bus, target).catch(() => null);
      const profiles = properties ? parseProfiles(properties) : null;
      if (profiles) {
        found = target;
        known = profiles;
        return profiles;
      }
    }
    known = null;
    return null;
  };

  let stopConnect: (() => void) | null = null;
  const startWatching = () => {
    stopConnect ??= link.onConnect(async (bus) => {
      for (const target of targets) {
        await onPropertiesChanged(bus, target, (changed) => {
          if (found && found !== target) return;
          const next = applyChange(known, changed);
          if (JSON.stringify(next) === JSON.stringify(known)) return;
          known = next;
          for (const listener of [...listeners]) listener(next);
        });
      }
    });
  };

  return {
    read,
    set: async (id) => {
      const bus = await link.bus().catch(() => null);
      const target = found ?? ((await read()) ? found : null);
      if (!bus || !target) return false;
      try {
        await setProperty(bus, target, "ActiveProfile", variant("s", id));
      } catch {
        return false;
      }
      return (await read())?.active === id;
    },
    watch: (listener) => {
      listeners.add(listener);
      startWatching();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopConnect?.();
          stopConnect = null;
        }
      };
    },
  };
}

/** A source over `real` that reads the machine's modes but only remembers a choice (a development run never changes the host's). */
export function shadowProfiles(real: ProfileSource): ProfileSource {
  let told: ProfileId | null = null;
  const shadow = (profiles: Profiles | null): Profiles | null =>
    profiles === null || told === null || !profiles.available.includes(told) ? profiles : { ...profiles, active: told };
  return {
    read: async () => shadow(await real.read()),
    set: async (id) => {
      told = id;
      return true;
    },
    watch: (listener) => real.watch((profiles) => listener(shadow(profiles))),
  };
}
