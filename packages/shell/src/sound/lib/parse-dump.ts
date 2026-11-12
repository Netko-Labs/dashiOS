/**
 * Outputs from `pw-dump`, PipeWire's JSON dump of its objects. An output is a
 * node whose media.class is Audio/Sink; the default is named by the "default"
 * metadata's `default.audio.sink`, by node.name. The dump is parsed strictly:
 * it must be a JSON array, and a sink needs an integer id and a label. Other
 * objects (streams, sources, devices, clients) are ignored. The same
 * reading works on the watcher's objects (apps/watch.ts): `devicesFrom` and
 * `defaultVolume`.
 */

import type { Volume } from "../../system/volume.ts";
import { volumeOf } from "../apps/index.ts";
import type { Output } from "../types.ts";
import { outputKind } from "./kind.ts";

type Props = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** An object's properties: a node keeps them under `info`, a metadata object at the top. */
function propsOf(object: Record<string, unknown>): Props {
  if (isRecord(object.info) && isRecord(object.info.props)) return object.info.props;
  return isRecord(object.props) ? object.props : {};
}

/** A property that is text and not blank. */
function textProp(props: Props, key: string): string | undefined {
  const value = props[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** Which side of the machine's audio: the outputs (sinks) or the inputs (sources). */
export type Side = "output" | "input";

/** A virtual source (a noise filter's, a null microphone) is an input as much as a sound card's. */
const SIDES = {
  output: { mediaClasses: ["Audio/Sink"], defaultKey: "default.audio.sink" },
  input: { mediaClasses: ["Audio/Source", "Audio/Source/Virtual"], defaultKey: "default.audio.source" },
} as const;

/** The default device's node.name, from the metadata entry for `default.audio.sink` (or `.source`). */
function defaultName(metadata: unknown, key: string): string | undefined {
  if (!Array.isArray(metadata)) return undefined;
  const entries: unknown[] = metadata;
  for (const entry of entries) {
    if (!isRecord(entry) || entry.key !== key || !isRecord(entry.value)) continue;
    const name = entry.value.name;
    if (typeof name === "string" && name !== "") return name;
  }
  return undefined;
}

/** The outputs (or inputs) in the dump's order, with the default marked; null if the text is not a dump. */
export function parseDump(text: string, side: Side = "output"): Output[] | null {
  let dump: unknown;
  try {
    dump = JSON.parse(text);
  } catch {
    return null;
  }
  return Array.isArray(dump) ? devicesFrom(dump, side) : null;
}

/** The outputs (or inputs) among PipeWire's objects (a dump, or the watcher's), in their order, with the default marked. */
export function devicesFrom(objects: readonly unknown[], side: Side = "output"): Output[] {
  const { mediaClasses, defaultKey } = SIDES[side];
  const isSide = (mediaClass: unknown): boolean => (mediaClasses as readonly unknown[]).includes(mediaClass);
  const sinks: Array<{ name: string | undefined; output: Output }> = [];
  const defaultNodeName = defaultOf(objects, defaultKey);
  for (const object of objects) {
    if (!isRecord(object)) continue;
    const props = propsOf(object);
    if (object.type !== "PipeWire:Interface:Node" || !isSide(props["media.class"])) continue;
    const id = object.id;
    const name = textProp(props, "node.name");
    const label = textProp(props, "node.description") ?? textProp(props, "node.nick") ?? name;
    // A sink without a usable id or label cannot be shown or chosen, so it is not an output.
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0 || label === undefined) continue;
    const kind = outputKind({ name, formFactor: textProp(props, "device.form-factor"), label });
    sinks.push({ name, output: { id, label, current: false, kind } });
  }
  return sinks.map(({ name, output }) => ({ ...output, current: name !== undefined && name === defaultNodeName }));
}

function defaultOf(objects: readonly unknown[], key: string): string | undefined {
  for (const object of objects) {
    if (!isRecord(object) || object.type !== "PipeWire:Interface:Metadata" || textProp(propsOf(object), "metadata.name") !== "default") continue;
    const name = defaultName(object.metadata, key);
    if (name !== undefined) return name;
  }
  return undefined;
}

/** The default output's (or input's) volume, as `wpctl get-volume @DEFAULT_AUDIO_SINK@` reads it; null without one. */
export function defaultVolume(objects: readonly unknown[], side: Side): Volume | null {
  const name = defaultOf(objects, SIDES[side].defaultKey);
  if (name === undefined) return null;
  const node = objects.find(
    (object): object is Record<string, unknown> =>
      isRecord(object) && object.type === "PipeWire:Interface:Node" && textProp(propsOf(object), "node.name") === name,
  );
  return node && isRecord(node.info) ? volumeOf(node.info) : null;
}
