/**
 * Which time and language service the shell talks to: systemd's, or the
 * in-memory stand-in. A development run gets the stand-in, so a nested shell
 * cannot change the developer's own time zone or language; `DASHI_FAKE_REGION`
 * is 1 or 0 to force it either way (see `system/stand-in.ts` for what makes a
 * run a development run).
 */

import { isDevelopmentRun, type Nesting } from "../system/stand-in.ts";
import type { RegionBackend } from "./lib/backend.ts";
import { FakeRegion, type FakeRegionOptions } from "./lib/fake.ts";
import { SystemdBackend } from "./lib/systemd.ts";

export interface RegionSetup {
  backend: RegionBackend;
  fake: boolean;
}

export function chooseRegion(env: Record<string, string | undefined> = process.env, nesting?: Nesting, standIn: FakeRegionOptions = {}): RegionSetup {
  const forced = env.DASHI_FAKE_REGION;
  const fake = forced === "1" ? true : forced === "0" ? false : isDevelopmentRun(env, nesting);
  if (fake) {
    console.error("dashi-shell: time zone and language are a stand-in here (this is a development run; DASHI_FAKE_REGION=0 uses systemd)");
    return { backend: new FakeRegion(standIn), fake: true };
  }
  return { backend: new SystemdBackend(), fake: false };
}
