/**
 * PipeWire objects as `pw-dump` prints them (the shapes seen in the VM,
 * dashi-0.5.0-review/49-volume-mixer/proof.md): two outputs and a
 * microphone; pw-play (native), paplay (Pulse), Helium's two tabs (two Pulse
 * streams from its audio service), a Flatpak (Lollypop), an event sound,
 * pw-record on the microphone and an app recording the speakers' monitor.
 */

type Json = Record<string, unknown>;

export const node = (id: number, props: Json, extra: { state?: string; volumes?: number[]; mute?: boolean } = {}): Json => ({
  id,
  type: "PipeWire:Interface:Node",
  version: 3,
  permissions: ["r", "w", "x", "m"],
  info: {
    "max-input-ports": 0,
    "max-output-ports": 64,
    "change-mask": ["input-ports", "output-ports", "state", "props", "params"],
    state: extra.state ?? "running",
    error: null,
    props: { "object.id": id, ...props },
    params: {
      EnumFormat: [],
      Props: [
        { volume: 1.0, mute: extra.mute ?? false, channelVolumes: extra.volumes ?? [1.0, 1.0], channelMap: ["FL", "FR"], softMute: false },
        { params: [] },
      ],
    },
  },
});

export const client = (id: number, props: Json): Json => ({
  id,
  type: "PipeWire:Interface:Client",
  version: 3,
  permissions: ["r", "w", "x", "m"],
  info: { "change-mask": ["props"], props: { "object.id": id, ...props } },
});

export const link = (id: number, from: number, to: number): Json => ({
  id,
  type: "PipeWire:Interface:Link",
  version: 3,
  permissions: ["r", "x"],
  info: { "output-node-id": from, "output-port-id": 1000 + id, "input-node-id": to, "input-port-id": 2000 + id, state: "active", error: null, props: {} },
});

export const metadata = (id: number, entries: Json[]): Json => ({
  id,
  type: "PipeWire:Interface:Metadata",
  version: 3,
  permissions: ["r", "w", "x", "m"],
  props: { "metadata.name": "default", "object.serial": 33 },
  metadata: entries,
});

const PULSE = { "client.api": "pipewire-pulse", "pipewire.sec.pid": 187795 };

export function vmGraph(): Json[] {
  return [
    client(30, { "application.name": "WirePlumber", "pipewire.sec.pid": 900, "application.process.id": 900 }),
    metadata(33, [
      { subject: 0, key: "default.audio.sink", type: "Spa:String:JSON", value: { name: "mixer-speakers" } },
      { subject: 0, key: "default.audio.source", type: "Spa:String:JSON", value: { name: "mixer-mic" } },
      { subject: 84, key: "target.object", type: null, value: "mixer-headphones" },
    ]),
    node(51, { "media.class": "Audio/Sink", "node.name": "mixer-speakers", "node.description": "Speakers" }),
    node(56, { "media.class": "Audio/Sink", "node.name": "mixer-headphones", "node.description": "Headphones", "device.form-factor": "headphones" }),
    node(62, { "media.class": "Audio/Source/Virtual", "node.name": "mixer-mic", "node.description": "Microphone" }),

    // pw-play: native, its pid vouched for by the socket.
    client(67, { "application.name": "pw-play", "application.process.id": 228856, "pipewire.sec.pid": 228856, "application.process.binary": "pw-cat" }),
    node(
      64,
      { "media.class": "Stream/Output/Audio", "client.id": 67, "application.name": "pw-play", "media.name": "tone-a.wav", "media.role": "Music" },
      { volumes: [0.166375] },
    ),
    link(100, 64, 51),

    // paplay: through pipewire-pulse, muted, 0.3 (0.027 linear).
    client(68, { "application.name": "paplay", "application.process.id": "228857", ...PULSE }),
    node(
      70,
      { "media.class": "Stream/Output/Audio", "client.id": 68, "application.name": "paplay", "media.name": "tone-b.wav" },
      { volumes: [0.027], mute: true },
    ),
    link(101, 70, 51),

    // Helium's two tabs: one audio service, two identical streams; the second paused, both sent to the headphones.
    client(80, { "application.name": "Helium", "application.process.id": "231610", ...PULSE }),
    node(84, { "media.class": "Stream/Output/Audio", "client.id": 80, "application.name": "Helium", "media.name": "Playback" }, { volumes: [0.125, 0.125] }),
    node(
      66,
      { "media.class": "Stream/Output/Audio", "client.id": 80, "application.name": "Helium", "media.name": "Playback" },
      { volumes: [0.343, 0.216], state: "idle" },
    ),
    link(102, 84, 56),
    link(103, 84, 56),
    link(104, 66, 56),

    // A Flatpak: the portal's id names it; the pid it claims is from inside its sandbox.
    client(90, {
      "application.name": "Lollypop",
      "application.process.id": 2,
      "pipewire.sec.pid": 4242,
      "pipewire.access.portal.app_id": "org.gnome.Lollypop",
    }),
    node(91, { "media.class": "Stream/Output/Audio", "client.id": 90, "application.name": "Lollypop", "media.name": "Song" }, { volumes: [0.0429] }),
    link(105, 91, 51),

    // An event sound: the system's, not a row.
    client(92, { "application.name": "Signal", "application.process.id": 5000, "pipewire.sec.pid": 5000 }),
    node(93, { "media.class": "Stream/Output/Audio", "client.id": 92, "media.role": "Event", "media.name": "bell" }),
    link(106, 93, 51),

    // pw-record on the microphone, and Signal recording too; a screen recorder on the speakers' monitor.
    client(63, { "application.name": "pw-record", "application.process.id": 228858, "pipewire.sec.pid": 228858 }),
    node(65, { "media.class": "Stream/Input/Audio", "client.id": 63, "application.name": "pw-record", "media.name": "-" }),
    link(107, 62, 65),
    node(94, { "media.class": "Stream/Input/Audio", "client.id": 92, "application.name": "Signal", "media.name": "call" }),
    link(108, 62, 94),
    client(95, { "application.name": "OBS", "application.process.id": 6000, "pipewire.sec.pid": 6000 }),
    node(96, { "media.class": "Stream/Input/Audio", "client.id": 95, "application.name": "OBS", "media.name": "desktop" }),
    link(109, 51, 96),
  ];
}
