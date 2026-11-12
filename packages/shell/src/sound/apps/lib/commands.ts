/**
 * Changing a stream's sound with PipeWire's own tools (separate MIT
 * programs, structured arguments only): `wpctl set-volume` (capped at 100%,
 * as the output volume is) and `wpctl set-mute` by node id, and
 * `pw-metadata <id> target.object <serial> Spa:Id` to send a stream to an
 * output, or have it record from an input, which WirePlumber carries out at
 * once; deleting the key sends it back to the default.
 *
 * WirePlumber remembers all three by itself (its stream state, per app:
 * `application.id`, else `application.name`, else `media.name`), and gives
 * them to the app's next stream: the volume and mute whenever the stream's
 * own change, and the target only when `target.object` holds the device's
 * object.serial, which it stores as the device's node.name. A target given
 * as a node.name is carried out but forgotten, so a name is used only for a
 * device that has no serial. Dashi keeps no table of its own.
 *
 * On a development run nothing is written (`heldControl`): the store keeps
 * the change in memory, as the output volume's stand-in does.
 */

import { run as defaultRun, type Run } from "../../../system/exec.ts";

const isNodeId = (id: number): boolean => Number.isSafeInteger(id) && id >= 0;

/** A node.name to hand `pw-metadata`: PipeWire's names are plain, and one starting with "-" would read as an option. */
export const isNodeName = (name: string): boolean => /^[A-Za-z0-9_][A-Za-z0-9_.:@+-]{0,254}$/.test(name);

export const clampLevel = (level: number): number => (Number.isFinite(level) ? Math.min(Math.max(level, 0), 1) : 0);

export function volumeCommands(ids: readonly number[], level: number): string[][] {
  const value = clampLevel(level).toFixed(2);
  return ids.filter(isNodeId).map((id) => ["wpctl", "set-volume", "-l", "1.0", String(id), value]);
}

export function muteCommands(ids: readonly number[], muted: boolean): string[][] {
  return ids.filter(isNodeId).map((id) => ["wpctl", "set-mute", String(id), muted ? "1" : "0"]);
}

/** A device to send streams to: its object.serial (what WirePlumber remembers it by), and its node.name for one without. */
export interface MoveTarget {
  serial: number | null;
  name: string;
}

/** Sends the streams to `target`, or back to the default with null. A target that can't be named gives no commands. */
export function moveCommands(ids: readonly number[], target: MoveTarget | null): string[][] {
  const nodes = ids.filter(isNodeId);
  if (target === null) return nodes.map((id) => ["pw-metadata", "-d", String(id), "target.object"]);
  if (target.serial !== null && isNodeId(target.serial)) {
    const serial = String(target.serial);
    return nodes.map((id) => ["pw-metadata", String(id), "target.object", serial, "Spa:Id"]);
  }
  if (!isNodeName(target.name)) return [];
  return nodes.map((id) => ["pw-metadata", String(id), "target.object", target.name]);
}

export interface MixerControl {
  /** Whether a change is only kept in memory (a development run): the store then shows it until it is changed again. */
  readonly held: boolean;
  setLevel(ids: readonly number[], level: number): Promise<boolean>;
  setMuted(ids: readonly number[], muted: boolean): Promise<boolean>;
  /** Sends playing streams to an output, or recording ones to an input; null is the default. */
  setTarget(ids: readonly number[], target: MoveTarget | null): Promise<boolean>;
}

async function runAll(run: Run, commands: readonly string[][]): Promise<boolean> {
  if (commands.length === 0) return false;
  const results = await Promise.all(commands.map((command) => run(command)));
  return results.every((result) => result !== null);
}

export function pipewireControl(run: Run = defaultRun): MixerControl {
  return {
    held: false,
    setLevel: (ids, level) => runAll(run, volumeCommands(ids, level)),
    setMuted: (ids, muted) => runAll(run, muteCommands(ids, muted)),
    setTarget: (ids, target) => runAll(run, moveCommands(ids, target)),
  };
}

/** A development run's: nothing reaches the developer's machine. */
export function heldControl(): MixerControl {
  const ok = async () => true;
  return { held: true, setLevel: ok, setMuted: ok, setTarget: ok };
}
