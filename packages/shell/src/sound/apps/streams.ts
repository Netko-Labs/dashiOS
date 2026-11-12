/**
 * Apps' sound streams from PipeWire's objects, as `pw-dump` gives them
 * (docs/architecture.md, "Sound"). A stream is a node whose media.class is
 * Stream/Output/Audio (it plays) or Stream/Input/Audio (it records); its
 * client says who made it, its links say which device it is on, its Props
 * param says its volume and mute, and the "default" metadata says the
 * device it was sent to (`target.object`), if any: the device's
 * object.serial, as WirePlumber writes and remembers it, or a node.name.
 * Either is told here as the device's node.name. Pure: objects in, streams,
 * outputs and inputs out. Every field is checked; an object that isn't what
 * it should be is skipped.
 *
 * Volumes: `wpctl` sets a level as the cube of what it is given, and
 * PipeWire reports the cube (0.5 shows as 0.125), so a level here is the
 * cube root, as `wpctl get-volume` and the sliders read it.
 */

import { infoOf, isId, isRecord, type Json, pid, propsOf, serialOf, text } from "./lib/objects.ts";

export type StreamDirection = "play" | "record";

/** What a stream is linked to: an output, an input (a microphone), or a sink's monitor ("this computer's sound"). */
export interface StreamDevice {
  id: number;
  /** object.serial: what a meter's recorder is pointed at. */
  serial: number | null;
  /** node.name, what `target.object` takes. */
  name: string | null;
  label: string;
  kind: "output" | "input" | "monitor";
}

export interface Stream {
  /** The node's id: what `wpctl` and `pw-metadata` take. */
  id: number;
  /** object.serial: what a meter's recorder is pointed at. */
  serial: number | null;
  direction: StreamDirection;
  /** application.name, as the app calls itself ("Helium", "SDL Application"). */
  appName: string | null;
  /** The pid the app says it is (application.process.id). */
  pid: number | null;
  /** The pid PipeWire saw on the socket (pipewire.sec.pid): for a Pulse client, pipewire-pulse's. */
  secPid: number | null;
  /** It came through pipewire-pulse. */
  pulse: boolean;
  /** A Flatpak's id from the portal (pipewire.access.portal.app_id). */
  portalAppId: string | null;
  /** application.icon_name, a theme icon's name. */
  iconName: string | null;
  mediaName: string | null;
  mediaRole: string | null;
  /** Sound is moving through it now (the node runs); a paused or corked stream doesn't. */
  running: boolean;
  /** 0 to 1 as the sliders read it (the cube root); the loudest channel. */
  level: number;
  muted: boolean;
  device: StreamDevice | null;
  /** The device it was sent to (`target.object`), as its node.name; null follows the default (and so does a device that is gone). */
  target: string | null;
  /** Not an app's own sound: event sounds, a filter's or a loopback's inner streams, a monitor. */
  internal: boolean;
}

/** An output (sink) a stream can be sent to, or an input (source) it can record from. */
export interface MixerOutput {
  id: number;
  /** object.serial: what `target.object` takes, and what WirePlumber remembers the device by (through its node.name). */
  serial: number | null;
  name: string;
  label: string;
}

export interface Graph {
  streams: Stream[];
  outputs: MixerOutput[];
  /** The microphones and other sources (never a sink's monitor). */
  inputs: MixerOutput[];
  /** The default output's node.name. */
  defaultOutput: string | null;
}

/** Event and notification sounds are the system's, not an app's to turn down here. */
const EVENT_ROLES = new Set(["notification", "event", "alert"]);

/** The level `wpctl` shows for a linear channel volume. */
export const levelOf = (linear: number): number => (linear <= 0 ? 0 : Math.cbrt(linear));

/** The node's Props param: its volume and mute. */
export function volumeOf(info: Json): { level: number; muted: boolean } {
  const params = isRecord(info.params) ? info.params : {};
  const props = Array.isArray(params.Props) ? params.Props : [];
  const found = props.find((entry): entry is Json => isRecord(entry) && (Array.isArray(entry.channelVolumes) || typeof entry.mute === "boolean"));
  if (!found) return { level: 1, muted: false };
  const channels = Array.isArray(found.channelVolumes) ? found.channelVolumes.filter((each): each is number => typeof each === "number" && each >= 0) : [];
  const overall = typeof found.volume === "number" && found.volume >= 0 ? found.volume : 1;
  const loudest = channels.length > 0 ? Math.max(...channels) : 1;
  return { level: Math.round(levelOf(loudest * overall) * 1000) / 1000, muted: found.mute === true };
}

/** `target.object` per node, from the "default" metadata; a value is an object.serial (a number, or one in text), a node.name, or `{ "name": … }`. */
function targetsOf(metadata: readonly Json[]): { targets: Map<number, string>; defaultOutput: string | null } {
  const targets = new Map<number, string>();
  let defaultOutput: string | null = null;
  for (const object of metadata) {
    if (text(propsOf(object), "metadata.name") !== "default" || !Array.isArray(object.metadata)) continue;
    for (const entry of object.metadata) {
      if (!isRecord(entry)) continue;
      const value = entryText(entry.value);
      if (value === null || value === "" || value === "-1") continue;
      if (entry.key === "target.object" && isId(entry.subject)) targets.set(entry.subject, value);
      if (entry.key === "default.audio.sink" && entry.subject === 0) defaultOutput = value;
    }
  }
  return { targets, defaultOutput };
}

function entryText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (isId(value)) return String(value);
  return isRecord(value) && typeof value.name === "string" ? value.name : null;
}

/** A device as a stream's target names it: its node.name. A serial is looked up; one that names nothing is no target. */
function targetName(target: string | undefined, nameBySerial: ReadonlyMap<number, string>): string | null {
  if (target === undefined) return null;
  return /^\d+$/.test(target) ? (nameBySerial.get(Number(target)) ?? null) : target;
}

const INPUT_CLASSES: ReadonlySet<string> = new Set(["Audio/Source", "Audio/Source/Virtual"]);

const deviceKind = (mediaClass: string | null, direction: StreamDirection): StreamDevice["kind"] | null => {
  if (mediaClass === null) return null;
  if (direction === "play") return mediaClass.startsWith("Audio/Sink") || mediaClass.startsWith("Audio/Duplex") ? "output" : null;
  if (mediaClass.startsWith("Audio/Source") || mediaClass.startsWith("Audio/Duplex")) return "input";
  return mediaClass.startsWith("Audio/Sink") ? "monitor" : null;
};

/** Each node's peers through the links: what it plays into (`into`), and what it records from (`from`). */
function linkPeers(records: readonly Json[]): { into: Map<number, number[]>; from: Map<number, number[]> } {
  const into = new Map<number, number[]>();
  const from = new Map<number, number[]>();
  for (const object of records) {
    if (object.type !== "PipeWire:Interface:Link") continue;
    const info = infoOf(object);
    const output = info["output-node-id"];
    const input = info["input-node-id"];
    if (!isId(output) || !isId(input)) continue;
    into.set(output, [...(into.get(output) ?? []), input]);
    from.set(input, [...(from.get(input) ?? []), output]);
  }
  return { into, from };
}

/** The first of a stream's peers that is a device on its side. */
function deviceOf(peers: readonly number[], byId: ReadonlyMap<number, Json>, direction: StreamDirection): StreamDevice | null {
  for (const peer of peers) {
    const node = byId.get(peer);
    if (!node || node.type !== "PipeWire:Interface:Node") continue;
    const props = propsOf(node);
    const kind = deviceKind(text(props, "media.class"), direction);
    if (kind === null) continue;
    const name = text(props, "node.name");
    return { id: peer, serial: serialOf(props), name, label: text(props, "node.description") ?? text(props, "node.nick") ?? name ?? String(peer), kind };
  }
  return null;
}

/** What a stream's own node and its client say of it; its device and target are the graph's to add. */
function streamOf(id: number, object: Json, direction: StreamDirection, clientProps: Json): Omit<Stream, "device" | "target"> {
  const info = infoOf(object);
  const props = propsOf(object);
  const either = (key: string) => text(props, key) ?? text(clientProps, key);
  const role = text(props, "media.role");
  return {
    id,
    serial: serialOf(props),
    direction,
    appName: either("application.name"),
    pid: pid(props, "application.process.id") ?? pid(clientProps, "application.process.id"),
    secPid: pid(clientProps, "pipewire.sec.pid"),
    pulse: text(clientProps, "client.api") === "pipewire-pulse",
    portalAppId: either("pipewire.access.portal.app_id"),
    iconName: either("application.icon_name"),
    mediaName: text(props, "media.name"),
    mediaRole: role,
    running: info.state === "running",
    ...volumeOf(info),
    internal:
      (role !== null && EVENT_ROLES.has(role.toLowerCase())) ||
      props["node.link-group"] !== undefined ||
      props["stream.monitor"] === true ||
      props["stream.monitor"] === "true",
  };
}

/** The streams, outputs and inputs among PipeWire's objects (a dump, or the watcher's map). */
export function parseGraph(objects: readonly unknown[]): Graph {
  const records = objects.filter(isRecord);
  const byId = new Map<number, Json>();
  const nameBySerial = new Map<number, string>();
  for (const object of records) {
    if (!isId(object.id)) continue;
    byId.set(object.id, object);
    if (object.type !== "PipeWire:Interface:Node") continue;
    const props = propsOf(object);
    const serial = serialOf(props);
    const name = text(props, "node.name");
    if (serial !== null && name !== null) nameBySerial.set(serial, name);
  }
  const { targets, defaultOutput } = targetsOf(records.filter((object) => object.type === "PipeWire:Interface:Metadata"));
  const { into, from } = linkPeers(records);

  const outputs: MixerOutput[] = [];
  const inputs: MixerOutput[] = [];
  const streams: Stream[] = [];
  for (const object of records) {
    if (object.type !== "PipeWire:Interface:Node" || !isId(object.id)) continue;
    const props = propsOf(object);
    const mediaClass = text(props, "media.class");
    if (mediaClass === "Audio/Sink" || (mediaClass !== null && INPUT_CLASSES.has(mediaClass))) {
      const name = text(props, "node.name");
      const label = text(props, "node.description") ?? text(props, "node.nick") ?? name;
      if (name !== null && label !== null) (mediaClass === "Audio/Sink" ? outputs : inputs).push({ id: object.id, serial: serialOf(props), name, label });
      continue;
    }
    const direction: StreamDirection | null = mediaClass === "Stream/Output/Audio" ? "play" : mediaClass === "Stream/Input/Audio" ? "record" : null;
    if (direction === null) continue;
    const client = byId.get(typeof props["client.id"] === "number" ? props["client.id"] : -1);
    const peers = (direction === "play" ? into.get(object.id) : from.get(object.id)) ?? [];
    streams.push({
      ...streamOf(object.id, object, direction, client ? propsOf(client) : {}),
      device: deviceOf(peers, byId, direction),
      target: targetName(targets.get(object.id), nameBySerial),
    });
  }
  return { streams, outputs, inputs, defaultOutput };
}
