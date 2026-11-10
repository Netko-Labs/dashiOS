/**
 * The volume mixer (sound/apps/): PipeWire's dump as app rows (grouping, naming, a browser's tabs,
 * several streams, a Flatpak), the monitor's updates, the commands that set, mute and move, the store's
 * order, linger and held changes, and the microphone indicator.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { catalogFrom, DASHI_KEY } from "../src/shared/processes/index.ts";
import {
  AppMixer,
  fixedGraph,
  GraphMap,
  type GraphWatch,
  heldControl,
  JsonArrays,
  type MixerControl,
  micIndicator,
  moveCommands,
  muteCommands,
  type ProcessLook,
  parseGraph,
  parseStatLine,
  playOnLabel,
  rowsFrom,
  type Stream,
  streamApp,
  streamOwners,
  volumeCommands,
} from "../src/sound/apps/index.ts";
import { parseDump } from "../src/sound/parse-dump.ts";
import { client, link, node, vmGraph } from "./fixtures/pw-graph.ts";
import { fakeClockEachTest, flush, settle } from "./support/time.ts";

fakeClockEachTest();

const HELIUM = { id: "helium", name: "Helium", icon: "/icons/helium.png", exec: ["/opt/helium/helium", "%U"] };
const LOLLYPOP = { id: "org.gnome.Lollypop", name: "Lollypop", icon: "/icons/lollypop.png", exec: ["flatpak", "run", "org.gnome.Lollypop"] };
const catalog = catalogFrom([HELIUM, LOLLYPOP, { id: "signal", name: "Signal", icon: "/icons/signal.png", exec: ["/usr/bin/signal-desktop"] }], []);

/** The processes of the proof: Helium's audio service under its browser, Signal, a sandboxed pid that must not be read. */
const PROCESSES = new Map<number, ProcessLook>([
  [231610, { comm: "helium", ppid: 229974, argv: ["/opt/helium/helium", "--type=utility", "--utility-sub-type=audio.mojom.AudioService"], cgroup: "" }],
  [229974, { comm: "helium", ppid: 1500, argv: ["/opt/helium/helium"], cgroup: "" }],
  [5000, { comm: "signal-desktop", ppid: 1500, argv: ["/usr/bin/signal-desktop"], cgroup: "" }],
  [228856, { comm: "pw-play", ppid: 1400, argv: ["pw-play", "--media-role=Music", "tone-a.wav"], cgroup: "" }],
  [1400, { comm: "bash", ppid: 1, argv: ["-bash"], cgroup: "" }],
  [2, { comm: "kthreadd", ppid: 0, argv: [], cgroup: "" }],
  [4242, { comm: "lollypop", ppid: 1, argv: ["/app/bin/lollypop"], cgroup: "0::/user.slice/app-flatpak-org.gnome.Lollypop-4242.scope\n" }],
]);
const owner = (stream: Stream) => streamApp(stream, { catalog, read: (pid: number) => PROCESSES.get(pid) ?? null });

describe("parseGraph: pw-dump as streams", () => {
  const graph = parseGraph(vmGraph());
  const byId = (id: number) => graph.streams.find((stream) => stream.id === id);

  test("outputs, and the default", () => {
    expect(graph.outputs).toEqual([
      { id: 51, name: "mixer-speakers", label: "Speakers" },
      { id: 56, name: "mixer-headphones", label: "Headphones" },
    ]);
    expect(graph.defaultOutput).toBe("mixer-speakers");
  });

  test("a native stream: its level is the cube root, its device from its links", () => {
    expect(byId(64)).toMatchObject({ direction: "play", appName: "pw-play", pid: 228856, secPid: 228856, pulse: false, running: true, muted: false });
    expect(byId(64)?.level).toBeCloseTo(0.55, 3);
    expect(byId(64)?.device).toEqual({ id: 51, name: "mixer-speakers", label: "Speakers", kind: "output" });
  });

  test("a Pulse stream: the pid it claims (a string), muted, and pipewire-pulse's socket pid", () => {
    expect(byId(70)).toMatchObject({ pid: 228857, secPid: 187795, pulse: true, muted: true });
    expect(byId(70)?.level).toBeCloseTo(0.3, 3);
  });

  test("the loudest channel, the target from the metadata, idle as not running", () => {
    expect(byId(66)?.level).toBeCloseTo(0.7, 3);
    expect(byId(66)?.running).toBe(false);
    expect(byId(84)?.target).toBe("mixer-headphones");
    expect(byId(66)?.target).toBeNull();
  });

  test("event sounds are internal; recording streams know a microphone from a monitor", () => {
    expect(byId(93)?.internal).toBe(true);
    expect(byId(65)?.device).toMatchObject({ label: "Microphone", kind: "input" });
    expect(byId(96)?.device).toMatchObject({ label: "Speakers", kind: "monitor" });
  });

  test("objects that aren't what they should be are skipped", () => {
    expect(parseGraph([null, 3, { id: "x" }, { id: 1, type: "PipeWire:Interface:Node" }])).toEqual({ streams: [], outputs: [], defaultOutput: null });
  });

  test("a stream without a Props param is at full volume, unmuted", () => {
    const bare = { ...node(5, { "media.class": "Stream/Output/Audio" }), info: { state: "running", props: { "media.class": "Stream/Output/Audio" } } };
    expect(parseGraph([bare]).streams[0]).toMatchObject({ level: 1, muted: false, device: null });
  });
});

describe("the devices' list", () => {
  test("a virtual source (a null microphone, a noise filter) is an input", () => {
    expect(parseDump(JSON.stringify(vmGraph()), "input")).toEqual([{ id: 62, label: "Microphone", current: true, kind: "speaker" }]);
    expect(parseDump(JSON.stringify(vmGraph()), "output")?.map((output) => output.label)).toEqual(["Speakers", "Headphones"]);
  });
});

describe("app rows", () => {
  const rows = rowsFrom(parseGraph(vmGraph()).streams, owner);
  const app = (name: string) => rows.apps.find((each) => each.name === name);

  test("one row per app; event sounds and recordings are not playing rows", () => {
    expect(rows.apps.map((each) => each.name).sort()).toEqual(["Helium", "Lollypop", "paplay", "pw-play"]);
  });

  test("a browser's two tabs are one row, named by its browser, at its loudest stream", () => {
    const helium = app("Helium");
    expect(helium).toMatchObject({
      key: "helium",
      icon: "/icons/helium.png",
      streams: [84, 66],
      playing: true,
      muted: false,
      output: "Headphones",
      target: "mixer-headphones",
    });
    expect(helium?.level).toBeCloseTo(0.7, 3);
  });

  test("a Flatpak is named by its portal id, never by the pid it claims", () => {
    expect(app("Lollypop")).toMatchObject({ key: "org.gnome.Lollypop", icon: "/icons/lollypop.png" });
  });

  test("an app no entry names keeps the name it gives itself", () => {
    expect(app("pw-play")).toMatchObject({ key: "sound:pw-play", playing: true, output: "Speakers" });
    expect(app("paplay")).toMatchObject({ muted: true });
  });

  test("several streams: muted only when every one is, playing when one is", () => {
    const graph = [
      client(1, { "application.name": "Game", "application.process.id": 10, "pipewire.sec.pid": 10 }),
      node(2, { "media.class": "Stream/Output/Audio", "client.id": 1 }, { mute: true, state: "idle" }),
      node(3, { "media.class": "Stream/Output/Audio", "client.id": 1 }, { mute: false, volumes: [0.008] }),
    ];
    const [game] = rowsFrom(parseGraph(graph).streams, owner).apps;
    expect(game).toMatchObject({ name: "Game", streams: [2, 3], muted: false, playing: true, level: 1 });
  });

  test("recording: the microphone's apps by name, a monitor apart", () => {
    expect(rows.recording).toEqual([
      { key: "sound:pw-record", name: "pw-record", icon: catalog.genericIcon, input: "Microphone", monitor: false },
      { key: "signal", name: "Signal", icon: "/icons/signal.png", input: "Microphone", monitor: false },
      { key: "sound:OBS", name: "OBS", icon: catalog.genericIcon, input: "Speakers", monitor: true },
    ]);
  });

  test("Dashi's own level meter is hidden; an app the shell launched keeps its name", () => {
    const shell = { comm: "bun", ppid: 1, argv: ["/usr/bin/bun", "/usr/share/dashi/shell/src/main.tsx"], cgroup: "" };
    const processes = new Map<number, ProcessLook>([
      [700, shell],
      [701, { comm: "pw-record", ppid: 700, argv: ["pw-record", "--raw", "-"], cgroup: "" }],
      [702, { comm: "mygame", ppid: 700, argv: ["/opt/mygame/mygame"], cgroup: "" }],
    ]);
    const owners = streamOwners({ catalog: () => catalog, read: (pid) => processes.get(pid) ?? null });
    const graph = parseGraph([
      client(1, { "application.name": "pw-record", "application.process.id": 701, "pipewire.sec.pid": 701 }),
      node(2, { "media.class": "Stream/Input/Audio", "client.id": 1 }),
      node(3, { "media.class": "Audio/Source", "node.name": "mic", "node.description": "Microphone" }),
      link(4, 3, 2),
      client(5, { "application.name": "My Game", "application.process.id": 702, "pipewire.sec.pid": 702 }),
      node(6, { "media.class": "Stream/Output/Audio", "client.id": 5 }),
    ]);
    const result = rowsFrom(graph.streams, owners);
    expect(result.recording).toEqual([]);
    expect(result.apps.map((each) => each.name)).toEqual(["My Game"]);
    expect(owners(graph.streams.find((stream) => stream.id === 2) as Stream)).toBeNull();
    expect(DASHI_KEY).toBe("dev.dashi.shell");
  });

  test("a window names a process no entry names, through its parents", async () => {
    const processes = new Map<number, ProcessLook>([
      [800, { comm: "audio", ppid: 801, argv: ["/opt/odd/audio-helper"], cgroup: "" }],
      [801, { comm: "odd", ppid: 1, argv: ["/opt/odd/odd"], cgroup: "" }],
    ]);
    let changed = 0;
    const owners = streamOwners({
      catalog: () => catalog,
      read: (pid) => processes.get(pid) ?? null,
      windows: async () => new Map([[801, { key: "odd", name: "Odd Player", icon: "/icons/odd.png" }]]),
      onChange: () => changed++,
    });
    const [stream] = parseGraph([
      client(1, { "application.name": "ALSA plug-in [audio]", "application.process.id": 800, "pipewire.sec.pid": 800 }),
      node(2, { "media.class": "Stream/Output/Audio", "client.id": 1 }),
    ]).streams;
    expect(owners(stream as Stream)?.name).toBe("ALSA plug-in [audio]");
    await flush();
    expect(changed).toBe(1);
    expect(owners(stream as Stream)?.name).toBe("Odd Player");
  });
});

describe("the monitor's output", () => {
  test("indented arrays across lines, strings with brackets, removals", () => {
    const arrays = new JsonArrays();
    const map = new GraphMap();
    const first = JSON.stringify([node(70, { "media.class": "Stream/Output/Audio", "media.name": 'a ] tricky [ "name"' }), link(9, 70, 51)], null, 2);
    const lines = first.split("\n");
    const done = lines.flatMap((line) => arrays.push(line));
    expect(done).toHaveLength(1);
    expect(map.apply(done[0] as string)).toBe(true);
    expect(map.values()).toHaveLength(2);
    const gone = arrays.push(JSON.stringify([{ id: 9, info: null }]));
    expect(map.apply(gone[0] as string)).toBe(true);
    expect(map.values().map((each) => each.id)).toEqual([70]);
    expect(arrays.push("pw-dump: a warning")).toEqual([]);
    expect(map.apply("[not json")).toBe(false);
  });

  test("an update replaces the whole object; a metadata object keeps its entries", () => {
    const map = new GraphMap();
    map.apply(JSON.stringify(vmGraph()));
    map.apply(
      JSON.stringify([node(70, { "media.class": "Stream/Output/Audio", "client.id": 68, "application.name": "paplay" }, { volumes: [0.125], mute: false })]),
    );
    const paplay = parseGraph(map.values()).streams.find((stream) => stream.id === 70);
    expect(paplay?.level).toBeCloseTo(0.5, 3);
    expect(paplay?.muted).toBe(false);
    expect(parseGraph(map.values()).streams.find((stream) => stream.id === 84)?.target).toBe("mixer-headphones");
  });
});

describe("a real dump (the VM, PipeWire 1.6.11)", () => {
  // pw-dump's own text, kept as it printed it (it repeats a key inside Tag params, which JSON.parse takes the last of).
  // pw-play and paplay playing on a null "Speakers", pw-record on a null "Microphone", and Settings' own level meter (pid 170666).
  const text = readFileSync(new URL("./fixtures/pw-dump-vm.txt", import.meta.url), "utf8");

  test("the monitor's lines put back together are the same dump", () => {
    const arrays = new JsonArrays();
    const done = text.split("\n").flatMap((line) => arrays.push(line));
    expect(done).toHaveLength(1);
    const map = new GraphMap();
    expect(map.apply(done[0] as string)).toBe(true);
    expect(parseGraph(map.values())).toEqual(parseGraph(JSON.parse(text)));
  });

  test("rows: the Pulse client named by the pid it claims, Dashi's meter hidden", () => {
    const shell = { comm: "bun", ppid: 1, argv: ["/usr/libexec/dashi/bin/bun", "/mnt/developer/dashiOS/packages/shell/src/main.tsx"], cgroup: "" };
    const processes = new Map<number, ProcessLook>([
      [172000, shell],
      [170666, { comm: "pw-record", ppid: 172000, argv: ["pw-record", "--raw", "-"], cgroup: "" }],
    ]);
    const graph = parseGraph(JSON.parse(text));
    const paplay = graph.streams.find((stream) => stream.appName === "paplay");
    expect(paplay).toMatchObject({ pulse: true, pid: 168644, secPid: 86425, level: 0.6 });
    const rows = rowsFrom(graph.streams, streamOwners({ catalog: () => catalog, read: (pid) => processes.get(pid) ?? null }));
    expect(rows.apps.map((app) => [app.name, app.level, app.output])).toEqual([
      ["pw-play", 1, "Speakers"],
      ["paplay", 0.6, "Speakers"],
    ]);
    expect(rows.recording).toEqual([{ key: "sound:pw-record", name: "pw-record", icon: catalog.genericIcon, input: "Microphone", monitor: false }]);
    expect(graph.outputs.map((output) => output.label)).toEqual(["Speakers", "Headphones"]);
  });
});

describe("the commands", () => {
  test("set: wpctl on each stream, capped at 100%", () => {
    expect(volumeCommands([84, 66], 0.5)).toEqual([
      ["wpctl", "set-volume", "-l", "1.0", "84", "0.50"],
      ["wpctl", "set-volume", "-l", "1.0", "66", "0.50"],
    ]);
    expect(volumeCommands([70], 1.7)).toEqual([["wpctl", "set-volume", "-l", "1.0", "70", "1.00"]]);
    expect(volumeCommands([70], Number.NaN)).toEqual([["wpctl", "set-volume", "-l", "1.0", "70", "0.00"]]);
    expect(volumeCommands([-1, 1.5], 0.5)).toEqual([]);
  });

  test("mute and unmute", () => {
    expect(muteCommands([84, 66], true)).toEqual([
      ["wpctl", "set-mute", "84", "1"],
      ["wpctl", "set-mute", "66", "1"],
    ]);
    expect(muteCommands([70], false)).toEqual([["wpctl", "set-mute", "70", "0"]]);
  });

  test("move: target.object by node.name, deleted for the default; never an option-looking name", () => {
    expect(moveCommands([84], "mixer-headphones")).toEqual([["pw-metadata", "84", "target.object", "mixer-headphones"]]);
    expect(moveCommands([84, 66], null)).toEqual([
      ["pw-metadata", "-d", "84", "target.object"],
      ["pw-metadata", "-d", "66", "target.object"],
    ]);
    expect(moveCommands([84], "-d")).toEqual([]);
    expect(moveCommands([84], "alsa_output.pci-0000_00_1f.3.analog-stereo")).toHaveLength(1);
  });

  test("Play on's words", () => {
    const outputs = parseGraph(vmGraph()).outputs;
    expect(playOnLabel(null, outputs)).toBe("Default");
    expect(playOnLabel("mixer-headphones", outputs)).toBe("Headphones");
    expect(playOnLabel("gone-sink", outputs)).toBe("gone-sink");
  });

  test("/proc's stat line, with a name that has spaces and parentheses", () => {
    expect(parseStatLine("231610 (Web Content (x)) S 229974 231610 0")).toEqual({ comm: "Web Content (x)", ppid: 229974 });
    expect(parseStatLine("garbage")).toBeNull();
  });
});

describe("the microphone indicator", () => {
  const recording = (name: string, monitor = false) => ({ key: name, name, icon: "", input: monitor ? "Speakers" : "Microphone", monitor });

  test("off with nobody recording, or only this computer's sound", () => {
    expect(micIndicator([])).toEqual({ on: false, names: [], words: "" });
    expect(micIndicator([recording("OBS", true)]).on).toBe(false);
  });

  test("names the apps", () => {
    expect(micIndicator([recording("Signal")])).toEqual({ on: true, names: ["Signal"], words: "Signal is using the microphone." });
    expect(micIndicator([recording("Signal"), recording("OBS", true), recording("Zoom")]).words).toBe("Signal and Zoom are using the microphone.");
    expect(micIndicator([recording("A"), recording("B"), recording("C")]).words).toBe("A and 2 more are using the microphone.");
  });

  test("from the dump: pw-record and Signal, not the monitor", () => {
    const rows = rowsFrom(parseGraph(vmGraph()).streams, owner);
    expect(micIndicator(rows.recording).names).toEqual(["pw-record", "Signal"]);
  });

  test("a paused recorder records nothing", () => {
    const graph = vmGraph().map((object) =>
      object.id === 94 ? node(94, { "media.class": "Stream/Input/Audio", "client.id": 92 }, { state: "idle" }) : object,
    );
    expect(micIndicator(rowsFrom(parseGraph(graph).streams, owner).recording).names).toEqual(["pw-record"]);
  });
});

/** A graph the test pushes by hand. */
function pushedGraph(): GraphWatch & { push(objects: Record<string, unknown>[]): void } {
  let listener: ((graph: ReturnType<typeof parseGraph>) => void) | null = null;
  return {
    available: true,
    start(onGraph) {
      listener = onGraph;
      return () => {
        listener = null;
      };
    },
    push(objects) {
      listener?.(parseGraph(objects));
    },
  };
}

function recordingControl(): MixerControl & { calls: string[] } {
  const calls: string[] = [];
  return {
    held: false,
    calls,
    setLevel: async (ids, level) => calls.push(`level ${ids.join(",")} ${level}`) > 0,
    setMuted: async (ids, muted) => calls.push(`mute ${ids.join(",")} ${muted}`) > 0,
    setOutput: async (ids, output) => calls.push(`output ${ids.join(",")} ${output}`) > 0,
  };
}

describe("the store", () => {
  test("newest first; a row lingers 5 s after its last stream, paused", () => {
    let now = 1000;
    const graph = pushedGraph();
    const mixer = new AppMixer({ graph, control: recordingControl(), owner, now: () => now });
    mixer.start();
    const all = vmGraph();
    const without = (ids: number[]) => all.filter((object) => !ids.includes(object.id as number));
    graph.push(without([84, 66, 91, 70]));
    now = 2000;
    graph.push(without([66, 84, 70]));
    expect(mixer.getSnapshot().apps.map((app) => app.name)).toEqual(["Lollypop", "pw-play"]);
    now = 3000;
    graph.push(without([70]));
    expect(mixer.getSnapshot().apps.map((app) => app.name)).toEqual(["Helium", "Lollypop", "pw-play"]);
    now = 4000;
    graph.push(without([70, 91]));
    expect(mixer.getSnapshot().apps.find((app) => app.name === "Lollypop")).toMatchObject({ playing: false, streams: [] });
    now = 9001;
    graph.push(without([70, 91]));
    expect(mixer.getSnapshot().apps.map((app) => app.name)).toEqual(["Helium", "pw-play"]);
    mixer.stop();
  });

  test("set, mute and move go to every stream of the app and show at once", async () => {
    const graph = pushedGraph();
    const control = recordingControl();
    const mixer = new AppMixer({ graph, control, owner });
    mixer.start();
    graph.push(vmGraph());
    const done = mixer.setLevel("helium", 0.4);
    expect(mixer.getSnapshot().apps.find((app) => app.key === "helium")?.level).toBe(0.4);
    expect(await done).toBe(true);
    expect(await mixer.setMuted("helium", true)).toBe(true);
    expect(await mixer.setOutput("helium", null)).toBe(true);
    expect(await mixer.setOutput("helium", "not-an-output")).toBe(false);
    expect(await mixer.setLevel("nobody", 0.4)).toBe(false);
    expect(control.calls).toEqual(["level 84,66 0.4", "mute 84,66 true", "output 84,66 null"]);
    // Raising a muted app unmutes it too.
    expect(await mixer.setLevel("sound:paplay", 0.6)).toBe(true);
    expect(control.calls.slice(-2)).toEqual(["level 70 0.6", "mute 70 false"]);
    mixer.stop();
  });

  test("while a write runs, newer levels replace the waiting one", async () => {
    const graph = pushedGraph();
    const levels: number[] = [];
    let release: () => void = () => {};
    const control: MixerControl = {
      ...recordingControl(),
      setLevel: (_ids, level) => {
        levels.push(level);
        return new Promise((resolve) => {
          release = () => resolve(true);
        });
      },
    };
    const mixer = new AppMixer({ graph, control, owner });
    mixer.start();
    graph.push(vmGraph());
    const first = mixer.setLevel("helium", 0.1);
    const skipped = mixer.setLevel("helium", 0.2);
    const last = mixer.setLevel("helium", 0.3);
    release();
    await first;
    await flush();
    release();
    expect(await Promise.all([skipped, last])).toEqual([true, true]);
    expect(levels).toEqual([0.1, 0.3]);
    mixer.stop();
  });

  test("a change is shown over PipeWire's word until it has had time to report it", async () => {
    let now = 0;
    const graph = pushedGraph();
    const mixer = new AppMixer({ graph, control: recordingControl(), owner, now: () => now, holdMs: 1000 });
    mixer.start();
    graph.push(vmGraph());
    await mixer.setMuted("sound:pw-play", true);
    graph.push(vmGraph());
    expect(mixer.getSnapshot().apps.find((app) => app.key === "sound:pw-play")?.muted).toBe(true);
    now = 1001;
    graph.push(vmGraph());
    expect(mixer.getSnapshot().apps.find((app) => app.key === "sound:pw-play")?.muted).toBe(false);
    mixer.stop();
  });

  test("a development run keeps the change in memory, and writes nothing", async () => {
    let now = 0;
    const graph = pushedGraph();
    const mixer = new AppMixer({ graph, control: heldControl(), owner, now: () => now });
    mixer.start();
    graph.push(vmGraph());
    await mixer.setLevel("helium", 0.25);
    now = 60_000;
    graph.push(vmGraph());
    expect(mixer.getSnapshot().apps.find((app) => app.key === "helium")?.level).toBe(0.25);
    mixer.stop();
  });

  test("a fixed graph, and no PipeWire", async () => {
    const mixer = new AppMixer({ graph: fixedGraph(parseGraph(vmGraph())), control: heldControl(), owner });
    mixer.start();
    await settle(1);
    expect(mixer.getSnapshot()).toMatchObject({ available: true, outputs: [{ label: "Speakers" }, { label: "Headphones" }] });
    expect(mixer.getSnapshot().recording.map((each) => each.name)).toEqual(["pw-record", "Signal", "OBS"]);
    mixer.stop();
    const none = new AppMixer({ graph: { available: false, start: () => () => {} }, control: heldControl(), owner });
    expect(none.getSnapshot()).toEqual({ available: false, apps: [], recording: [], outputs: [] });
  });
});
