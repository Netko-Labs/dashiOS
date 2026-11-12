/**
 * The volume mixer's app rows from PipeWire's dump (sound/apps/): one row per app, a browser's tabs,
 * a Flatpak's name, several streams, the apps that record, and the microphone indicator.
 */

import { describe, expect, test } from "bun:test";
import { DASHI_KEY } from "../src/shared/processes/index.ts";
import { micIndicator, parseGraph, rowsFrom, type Stream } from "../src/sound/apps/index.ts";
import type { ProcessLook } from "../src/sound/apps/lib/identity.ts";
import { streamOwners } from "../src/sound/apps/lib/owners.ts";
import { client, link, node, vmGraph } from "./fixtures/pw-graph.ts";
import { catalog, owner } from "./support/sound-mixer.ts";
import { fakeClockEachTest, flush } from "./support/time.ts";

fakeClockEachTest();

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
