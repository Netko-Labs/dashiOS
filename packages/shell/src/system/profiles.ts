/**
 * Power modes through power-profiles-daemon's `powerprofilesctl`: Low Power
 * (power-saver), Balanced, and High Performance (performance, which not every
 * machine has). The tool's text is parsed strictly; a machine without the
 * daemon has no power modes, and the pane leaves the row out.
 */

import type { Run } from "./exec.ts";

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

/** `powerprofilesctl list`: a `* name:` line is the active one, indented lines under it are the driver's. */
export function parseProfileList(text: string): Profiles | null {
  const found: ProfileId[] = [];
  let active: ProfileId | null = null;
  for (const line of text.split("\n")) {
    const match = /^(\*?)\s*([a-z-]+):\s*$/.exec(line);
    if (!match || !isProfileId(match[2])) continue;
    found.push(match[2]);
    if (match[1] === "*") active = match[2];
  }
  if (found.length === 0 || active === null) return null;
  return { available: PROFILE_IDS.filter((id) => found.includes(id)), active };
}

export interface ProfileSource {
  /** Null without the daemon. */
  read(): Promise<Profiles | null>;
  /** True when the mode is now `id`. */
  set(id: ProfileId): Promise<boolean>;
}

export function powerprofilesctl(run: Run): ProfileSource {
  return {
    read: async () => {
      const list = await run(["powerprofilesctl", "list"]);
      return list === null ? null : parseProfileList(list);
    },
    set: async (id) => (await run(["powerprofilesctl", "set", id])) !== null,
  };
}

/** A source over `real` that reads the machine's modes but only remembers a choice (a development run never changes the host's). */
export function shadowProfiles(real: ProfileSource): ProfileSource {
  let told: ProfileId | null = null;
  return {
    read: async () => {
      const profiles = await real.read();
      return profiles === null || told === null || !profiles.available.includes(told) ? profiles : { ...profiles, active: told };
    },
    set: async (id) => {
      told = id;
      return true;
    },
  };
}
