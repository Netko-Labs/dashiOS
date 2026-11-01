/**
 * The sound outputs' backend: PipeWire through its own tools. The list comes
 * from `pw-dump` (or `wpctl status` where that is missing or unreadable), and
 * a default is set with `wpctl set-default`, structured arguments only.
 *
 * On a development run the list is still read from the host, but a default
 * is only remembered here, never made on the developer's machine (the same
 * rule as the radios, `control-center/radios.ts`).
 */

import { type Run, run as defaultRun } from "../system/exec.ts";
import { parseDump, type Side } from "./parse-dump.ts";
import { parseStatus } from "./parse-status.ts";
import type { AudioBackend, Output, SoundBackend } from "./types.ts";

async function listSide(run: Run, side: Side): Promise<Output[] | null> {
  const dump = await run(["pw-dump"]);
  const fromDump = dump === null ? null : parseDump(dump, side);
  if (fromDump !== null) return fromDump;
  const status = await run(["wpctl", "status"]);
  return status === null ? null : parseStatus(status, side);
}

export function pipewireBackend(run: Run = defaultRun): AudioBackend {
  return {
    list: () => listSide(run, "output"),
    listInputs: () => listSide(run, "input"),
    setDefault: async (id) => (await run(["wpctl", "set-default", String(id)])) !== null,
  };
}

/**
 * A stand-in over `real`: the list is the host's as it is, until a default is
 * set; from then on the chosen output reads as the default (as long as it is
 * still in the list), and nothing is written.
 */
export function shadowBackend(real: AudioBackend): AudioBackend {
  // A choice is remembered per side: an output id never names an input.
  const told: Record<Side, number | null> = { output: null, input: null };
  const shadow = (list: Output[] | null, side: Side): Output[] | null => {
    const chosen = told[side];
    if (list === null || chosen === null || !list.some((output) => output.id === chosen)) return list;
    return list.map((output) => ({ ...output, current: output.id === chosen }));
  };
  return {
    list: async () => shadow(await real.list(), "output"),
    listInputs: async () => shadow(await real.listInputs(), "input"),
    setDefault: async (id) => {
      // The id is the side's whose list has it; the lists are the machine's, so ask them.
      const [outputs, inputs] = await Promise.all([real.list(), real.listInputs()]);
      if (inputs?.some((input) => input.id === id)) told.input = id;
      else if (outputs?.some((output) => output.id === id) ?? true) told.output = id;
      return true;
    },
  };
}

/** The backend a run gets: the machine's own, or the stand-in on a development run. */
export function soundBackendFor(options: { standIn: boolean; run?: Run }): AudioBackend {
  const real = pipewireBackend(options.run);
  return options.standIn ? shadowBackend(real) : real;
}

/** The inputs of an audio backend as a `SoundBackend`, so a `SoundStore` can list and choose them. */
export function inputsOf(audio: AudioBackend): SoundBackend {
  return { list: () => audio.listInputs(), setDefault: (id) => audio.setDefault(id) };
}
