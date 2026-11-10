/**
 * The volume mixer's commands (wpctl, pw-metadata, /proc) and its store: newest first, a row lingering
 * after its last stream, set, mute and move to every stream, writes in order, and held changes.
 */

import { describe, expect, test } from "bun:test";
import { AppMixer, fixedGraph, parseGraph, playOnLabel } from "../src/sound/apps/index.ts";
import { heldControl, type MixerControl, moveCommands, muteCommands, volumeCommands } from "../src/sound/apps/lib/commands.ts";
import { parseStatLine } from "../src/sound/apps/lib/proc-look.ts";
import { vmGraph } from "./fixtures/pw-graph.ts";
import { owner, pushedGraph, recordingControl } from "./support/sound-mixer.ts";
import { fakeClockEachTest, flush, settle } from "./support/time.ts";

fakeClockEachTest();

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
