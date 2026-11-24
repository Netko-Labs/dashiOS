/**
 * Windows come back where they were (decisions.md D531, D534): what an app's last window leaves as it
 * closes, the file it is kept in (outside data: parsed, damage dropped), and its next first window
 * opening there.
 */

import { describe, expect, test } from "bun:test";
import { Arranger } from "../src/arrange/arrange.ts";
import { MOST_APPS, memoryOf, memoryText, parseMemory, recall } from "../src/arrange/lib/memory.ts";
import { MemoryFile, memoryPath } from "../src/arrange/lib/memory-file.ts";
import type { Output } from "../src/layout.ts";
import { flush } from "./support/time.ts";
import { fake, rect, SCREEN, USABLE } from "./support/window-arrange.ts";

const SECOND: Output = { name: "HDMI-A-1", identity: "port:HDMI-A-1", frame: rect(1646, 0, 1920, 1080), usable: rect(1646, 28, 1920, 981), scale: 1 };
const FIRST: Output = { name: "Virtual-1", identity: "port:Virtual-1", frame: SCREEN, usable: USABLE, scale: 1 };

describe("what is kept", () => {
  test("the frame from its screen's top left, the screen by its identity, and how it was arranged", () => {
    expect(memoryOf(rect(1746, 80, 900, 700), { tile: null, fullscreen: false }, [FIRST, SECOND], 5)).toEqual({
      screen: "port:HDMI-A-1",
      frame: rect(100, 80, 900, 700),
      tile: null,
      fullscreen: false,
      at: 5,
    });
    // Off every screen (it was waiting where a screen used to be): nothing to keep.
    expect(memoryOf(rect(9000, 80, 900, 700), { tile: null, fullscreen: false }, [FIRST, SECOND], 5)).toBeNull();
  });

  test("the file reads back what it wrote; a damaged entry is dropped alone, a damaged file is none", () => {
    const kept = new Map([["dev.dashi.notes", { screen: "port:Virtual-1", frame: rect(10, 40, 800, 600), tile: "left" as const, fullscreen: false, at: 3 }]]);
    expect(parseMemory(JSON.parse(memoryText(kept)))).toEqual(kept);
    const damaged = {
      version: 1,
      apps: { "dev.dashi.notes": kept.get("dev.dashi.notes"), bad: { screen: "x", frame: { x: "1" } }, "": kept.get("dev.dashi.notes") },
    };
    expect([...parseMemory(damaged).keys()]).toEqual(["dev.dashi.notes"]);
    expect(parseMemory({ version: 2, apps: {} }).size).toBe(0);
    expect(parseMemory("nonsense").size).toBe(0);
  });

  test("at most 256 apps: the longest closed go first", () => {
    const apps = Object.fromEntries(
      Array.from({ length: MOST_APPS + 10 }, (_, at) => [`app.${at}`, { screen: "s", frame: rect(0, 0, 100, 100), tile: null, fullscreen: false, at }]),
    );
    const read = parseMemory({ version: 1, apps });
    expect(read.size).toBe(MOST_APPS);
    expect(read.has("app.0")).toBe(false);
    expect(read.has(`app.${MOST_APPS + 9}`)).toBe(true);
  });

  test("its screen back, the frame is pulled inside the usable area; a tile is the tile there", () => {
    const memory = { screen: "port:Virtual-1", frame: rect(-50, 900, 800, 600), tile: null, fullscreen: false, at: 1 };
    expect(recall(memory, [FIRST], USABLE).frame).toEqual(rect(0, 866 - 600, 800, 600));
    expect(recall({ ...memory, tile: "fill" }, [FIRST], USABLE).frame).toEqual(USABLE);
  });

  test("the file is the person's, under ~/.config/dashi, written once for a burst of closes", async () => {
    expect(memoryPath({ XDG_CONFIG_HOME: "/x/config" }, "/home/alexk")).toBe("/x/config/dashi/windows.json");
    expect(memoryPath({}, "/home/alexk")).toBe("/home/alexk/.config/dashi/windows.json");
    const writes: string[] = [];
    const file = new MemoryFile("/nowhere/windows.json", (_, text) => writes.push(text));
    const memory = { screen: "s", frame: rect(0, 30, 400, 300), tile: null, fullscreen: false, at: 1 };
    file.set("a", memory);
    file.set("b", memory);
    await flush();
    expect(writes).toHaveLength(1);
    expect(Object.keys(JSON.parse(writes[0] ?? "{}").apps)).toEqual(["a", "b"]);
  });
});

describe("closing and opening again", () => {
  const notes = {
    id: 7,
    appId: "dev.dashi.notes",
    title: "Notes",
    pid: 9,
    focused: true,
    state: "normal" as const,
    frame: rect(1800, 200, 900, 700),
    titleBar: 0,
  };

  test("the last window's frame is kept as it closes, and the app's next first window opens there", async () => {
    const windows = [{ ...notes }];
    const world = fake(windows, [FIRST, SECOND]);
    const file = new MemoryFile(null);
    const arranger = new Arranger(world.compositor, file);
    await arranger.start();
    await world.emit({ event: "window-placing", window: { id: 7, appId: "dev.dashi.notes", title: "Notes", width: 900, height: 700 } });
    windows.length = 0;
    await world.emit({ event: "window-closed", id: 7, frame: rect(1800, 200, 900, 700) });
    expect(file.get("dev.dashi.notes")).toMatchObject({ screen: "port:HDMI-A-1", frame: rect(154, 200, 900, 700) });
    world.requests.length = 0;
    await world.emit({ event: "window-placing", window: { id: 8, appId: "dev.dashi.notes", title: "Notes", width: 640, height: 480 } });
    expect(world.requests.filter(([method]) => method === "place" || method === "frame")).toEqual([
      ["place", { window: 8, x: 1800, y: 200 }],
      ["frame", { window: 8, x: 1800, y: 200, width: 900, height: 700 }],
    ]);
  });

  test("a dialog, or a window that asked for its spot, leaves nothing", async () => {
    const world = fake([], [FIRST, SECOND]);
    const file = new MemoryFile(null);
    await new Arranger(world.compositor, file).start();
    await world.emit({ event: "window-placing", window: { id: 7, appId: "a.dialog", title: "", width: 400, height: 300, parent: 3 } });
    await world.emit({ event: "window-placing", window: { id: 8, appId: "an.x11", title: "", width: 400, height: 300, position: { x: 5, y: 5 } } });
    await world.emit({ event: "window-closed", id: 7, frame: rect(10, 40, 400, 300) });
    await world.emit({ event: "window-closed", id: 8, frame: rect(10, 40, 400, 300) });
    expect(file.get("a.dialog")).toBeNull();
    expect(file.get("an.x11")).toBeNull();
  });

  test("full screen comes back only when the person chose it, not when the app went full screen itself", async () => {
    const world = fake([{ ...notes, frame: rect(100, 100, 900, 700) }], [FIRST]);
    const file = new MemoryFile(null);
    const arranger = new Arranger(world.compositor, file);
    await arranger.start();
    await world.emit({ event: "window-placing", window: { id: 7, appId: "dev.dashi.notes", title: "Notes", width: 900, height: 700 } });
    await world.emit({ event: "fullscreen", window: 7, on: true });
    await world.emit({ event: "window-closed", id: 7, frame: rect(100, 100, 900, 700), fullscreen: true });
    expect(file.get("dev.dashi.notes")?.fullscreen).toBe(false);
    world.requests.length = 0;
    const again = fake([{ ...notes, frame: rect(100, 100, 900, 700) }], [FIRST]);
    const second = new Arranger(again.compositor, file);
    await second.start();
    await again.emit({ event: "window-placing", window: { id: 7, appId: "dev.dashi.notes", title: "Notes", width: 900, height: 700 } });
    await second.toggleFullscreen(7);
    await again.emit({ event: "window-closed", id: 7, frame: rect(100, 100, 900, 700), fullscreen: true });
    expect(file.get("dev.dashi.notes")?.fullscreen).toBe(true);
  });
});
