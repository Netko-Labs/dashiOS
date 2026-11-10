/**
 * The volume mixer's reading of PipeWire's dump (sound/apps/): the streams and outputs parsed, the devices'
 * list, the monitor's output as lines, and a real dump from the VM.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { GraphMap, JsonArrays, type ProcessLook, parseGraph, rowsFrom, streamOwners } from "../src/sound/apps/index.ts";
import { parseDump } from "../src/sound/parse-dump.ts";
import { link, node, vmGraph } from "./fixtures/pw-graph.ts";
import { catalog } from "./support/sound-mixer.ts";
import { fakeClockEachTest } from "./support/time.ts";

fakeClockEachTest();

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
