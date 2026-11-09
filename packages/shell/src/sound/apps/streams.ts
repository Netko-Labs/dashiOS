/**
 * Apps' sound streams from PipeWire's objects, as `pw-dump` gives them
 * (docs/architecture.md, "Sound"). A stream is a node whose media.class is
 * Stream/Output/Audio (it plays) or Stream/Input/Audio (it records); its
 * client says who made it, its links say which device it is on, its Props
 * param says its volume and mute, and the "default" metadata says the
 * output it was sent to (`target.object`), if any. Pure: objects in,
 * streams and outputs out. Every field is checked; an object that isn't
 * what it should be is skipped.
 *
 * Volumes: `wpctl` sets a level as the cube of what it is given, and
 * PipeWire reports the cube (0.5 shows as 0.125), so a level here is the
 * cube root, as `wpctl get-volume` and the sliders read it.
 */

type Json = Record<string, unknown>;

export const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function text(props: Json, key: string): string | null {
  const value = props[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** A pid as PipeWire writes it: a number, or a number in a string (Pulse clients). */
function pid(props: Json, key: string): number | null {
  const value = props[key];
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return isId(number) && number > 0 ? number : null;
}

function infoOf(object: Json): Json {
  return isRecord(object.info) ? object.info : {};
}

function propsOf(object: Json): Json {
  const info = infoOf(object);
  if (isRecord(info.props)) return info.props;
  return isRecord(object.props) ? object.props : {};
}

export type StreamDirection = "play" | "record";

/** What a stream is linked to: an output, an input (a microphone), or a sink's monitor ("this computer's sound"). */
export interface StreamDevice {
  id: number;
  /** node.name, what `target.object` takes. */
  name: string | null;
  label: string;
  kind: "output" | "input" | "monitor";
}

export interface Stream {
  /** The node's id: what `wpctl` and `pw-metadata` take. */
  id: number;
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
  /** The output it was sent to (`target.object`: a node.name or serial); null follows the default. */
  target: string | null;
  /** Not an app's own sound: event sounds, a filter's or a loopback's inner streams, a monitor. */
  internal: boolean;
}

/** An output (sink) a stream can be sent to. */
export interface MixerOutput {
  id: number;
  name: string;
  label: string;
}

export interface Graph {
  streams: Stream[];
  outputs: MixerOutput[];
  /** The default output's node.name. */
  defaultOutput: string | null;
}

/** Event and notification sounds are the system's, not an app's to turn down here. */
const EVENT_ROLES = new Set(["notification", "event", "alert"]);

/** The level `wpctl` shows for a linear channel volume. */
export const levelOf = (linear: number): number => (linear <= 0 ? 0 : Math.cbrt(linear));

/** The node's Props param: its volume and mute. */
function volumeOf(info: Json): { level: number; muted: boolean } {
  const params = isRecord(info.params) ? info.params : {};
  const props = Array.isArray(params.Props) ? params.Props : [];
  const found = props.find((entry): entry is Json => isRecord(entry) && (Array.isArray(entry.channelVolumes) || typeof entry.mute === "boolean"));
  if (!found) return { level: 1, muted: false };
  const channels = Array.isArray(found.channelVolumes) ? found.channelVolumes.filter((each): each is number => typeof each === "number" && each >= 0) : [];
  const overall = typeof found.volume === "number" && found.volume >= 0 ? found.volume : 1;
  const loudest = channels.length > 0 ? Math.max(...channels) : 1;
  return { level: Math.round(levelOf(loudest * overall) * 1000) / 1000, muted: found.mute === true };
}

/** `target.object` per node, from the "default" metadata; a value is a node.name (text) or `{ "name": … }`. */
function targetsOf(metadata: readonly Json[]): { targets: Map<number, string>; defaultOutput: string | null } {
  const targets = new Map<number, string>();
  let defaultOutput: string | null = null;
  for (const object of metadata) {
    if (text(propsOf(object), "metadata.name") !== "default" || !Array.isArray(object.metadata)) continue;
    for (const entry of object.metadata) {
      if (!isRecord(entry)) continue;
      const value = typeof entry.value === "string" ? entry.value : isRecord(entry.value) && typeof entry.value.name === "string" ? entry.value.name : null;
      if (value === null || value === "") continue;
      if (entry.key === "target.object" && isId(entry.subject)) targets.set(entry.subject, value);
      if (entry.key === "default.audio.sink" && entry.subject === 0) defaultOutput = value;
    }
  }
  return { targets, defaultOutput };
}

const deviceKind = (mediaClass: string | null, direction: StreamDirection): StreamDevice["kind"] | null => {
  if (mediaClass === null) return null;
  if (direction === "play") return mediaClass.startsWith("Audio/Sink") || mediaClass.startsWith("Audio/Duplex") ? "output" : null;
  if (mediaClass.startsWith("Audio/Source") || mediaClass.startsWith("Audio/Duplex")) return "input";
  return mediaClass.startsWith("Audio/Sink") ? "monitor" : null;
};

/** The streams and outputs among PipeWire's objects (a dump, or the watcher's map). */
export function parseGraph(objects: readonly unknown[]): Graph {
  const records = objects.filter(isRecord);
  const byId = new Map<number, Json>();
  for (const object of records) if (isId(object.id)) byId.set(object.id, object);
  const { targets, defaultOutput } = targetsOf(records.filter((object) => object.type === "PipeWire:Interface:Metadata"));

  // Each node's peers through its links: what it plays into, and what it records from.
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

  const outputs: MixerOutput[] = [];
  const streams: Stream[] = [];
  for (const object of records) {
    if (object.type !== "PipeWire:Interface:Node" || !isId(object.id)) continue;
    const info = infoOf(object);
    const props = propsOf(object);
    const mediaClass = text(props, "media.class");
    if (mediaClass === "Audio/Sink") {
      const name = text(props, "node.name");
      const label = text(props, "node.description") ?? text(props, "node.nick") ?? name;
      if (name !== null && label !== null) outputs.push({ id: object.id, name, label });
      continue;
    }
    const direction: StreamDirection | null = mediaClass === "Stream/Output/Audio" ? "play" : mediaClass === "Stream/Input/Audio" ? "record" : null;
    if (direction === null) continue;
    const client = byId.get(typeof props["client.id"] === "number" ? props["client.id"] : -1);
    const clientProps = client ? propsOf(client) : {};
    const either = (key: string) => text(props, key) ?? text(clientProps, key);
    const peers = (direction === "play" ? into.get(object.id) : from.get(object.id)) ?? [];
    let device: StreamDevice | null = null;
    for (const peer of peers) {
      const node = byId.get(peer);
      if (!node || node.type !== "PipeWire:Interface:Node") continue;
      const nodeProps = propsOf(node);
      const kind = deviceKind(text(nodeProps, "media.class"), direction);
      if (kind === null) continue;
      const name = text(nodeProps, "node.name");
      device = { id: peer, name, label: text(nodeProps, "node.description") ?? text(nodeProps, "node.nick") ?? name ?? String(peer), kind };
      break;
    }
    const role = text(props, "media.role");
    const { level, muted } = volumeOf(info);
    streams.push({
      id: object.id,
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
      level,
      muted,
      device,
      target: targets.get(object.id) ?? null,
      internal:
        (role !== null && EVENT_ROLES.has(role.toLowerCase())) ||
        props["node.link-group"] !== undefined ||
        props["stream.monitor"] === true ||
        props["stream.monitor"] === "true",
    });
  }
  return { streams, outputs, defaultOutput };
}
