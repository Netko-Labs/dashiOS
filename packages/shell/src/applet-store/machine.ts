/**
 * What Software knows about this machine, for "fits this machine"
 * (an applet's `when`, @dashi/applet's when.ts): DMI from /sys (readable by
 * anyone; nothing is written) and what dashi-hardware reports, if it runs.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Machine } from "@dashi/applet";

/** DMI chassis types that are portable (SMBIOS 3.x: laptop, notebook, sub-notebook, convertible, detachable, tablet…). */
const PORTABLE = new Set([8, 9, 10, 11, 14, 30, 31, 32]);

function read(dir: string, name: string): string | undefined {
  try {
    const text = readFileSync(join(dir, name), "utf8").trim();
    return text === "" ? undefined : text;
  } catch {
    return undefined;
  }
}

/** The names `when.hardware` can ask for, from dashi-hardware's Describe (docs/hardware.md). */
export function hardwareNames(describe: unknown): string[] {
  if (typeof describe !== "object" || describe === null) return [];
  const fields = describe as Record<string, unknown>;
  const names = new Set<string>();
  if (typeof fields.knobs === "object" && fields.knobs !== null) for (const knob of Object.keys(fields.knobs)) names.add(knob);
  if (Array.isArray(fields.fans) && fields.fans.some((fan) => typeof fan === "object" && fan !== null && (fan as Record<string, unknown>).curve === true))
    names.add("fan-curves");
  const lighting = fields.lighting as Record<string, unknown> | undefined;
  if (lighting?.slash === true) names.add("slash");
  if (lighting?.aura === true) names.add("aura");
  if (typeof lighting?.keyboard === "object" && lighting.keyboard !== null) names.add("keyboard-light");
  return [...names].sort();
}

/** busctl's answer to Describe (`s "{…}"`) → the JSON in it. */
export function parseBusctlString(output: string): unknown {
  const match = /^s\s+(".*")\s*$/s.exec(output.trim());
  if (!match?.[1]) return null;
  try {
    return JSON.parse(JSON.parse(match[1]) as string);
  } catch {
    return null;
  }
}

async function describeHardware(): Promise<unknown> {
  const busctl = Bun.which("busctl");
  if (!busctl) return null;
  try {
    const child = Bun.spawn([busctl, "--system", "call", "dev.dashi.Hardware1", "/dev/dashi/Hardware1", "dev.dashi.Hardware1", "Describe"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const timer = setTimeout(() => child.kill(), 3000);
    const [code, out] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    clearTimeout(timer);
    return code === 0 ? parseBusctlString(out) : null;
  } catch {
    return null;
  }
}

export async function readMachine(dmi = "/sys/class/dmi/id", describe: () => Promise<unknown> = describeHardware): Promise<Machine> {
  const chassis = Number(read(dmi, "chassis_type"));
  const vendor = read(dmi, "sys_vendor");
  const product = read(dmi, "product_name");
  const board = read(dmi, "board_name");
  const family = read(dmi, "product_family");
  const reported = await describe();
  return {
    ...(vendor === undefined ? {} : { vendor }),
    ...(product === undefined ? {} : { product }),
    ...(board === undefined ? {} : { board }),
    ...(family === undefined ? {} : { family }),
    ...(Number.isFinite(chassis) && chassis > 0 ? { laptop: PORTABLE.has(chassis) } : {}),
    ...(reported === null ? {} : { hardware: hardwareNames(reported) }),
  };
}
