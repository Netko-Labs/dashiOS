import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DASHI_WIDGETS } from "../src/widgets/catalog.ts";
import { tagOf } from "../src/widgets/edit.tsx";
import { type Placement, WidgetStore } from "../src/widgets/index.ts";
import { cycleSize, dropIndex, editKey, galleryKey, hostKey, stepSize } from "../src/widgets/lib/edit-keys.ts";
import { weatherOnAir } from "../src/widgets/lib/on-air.ts";

const placements: Placement[] = [
  { id: "a", kind: "rundown", size: "large" },
  { id: "b", kind: "weather", size: "small" },
  { id: "c", kind: "battery", size: "small" },
];
const sizesOf = (placement: Placement) => DASHI_WIDGETS.find((info) => info.kind === placement.kind)?.sizes ?? [];
const key = (k: string, alt = false, shift = false) => ({ key: k, alt, shift });

describe("editing from the keyboard", () => {
  test("Tab and ⇧Tab go from widget to widget, round", () => {
    expect(editKey(placements, null, key("Tab"), sizesOf)).toEqual({ do: "select", id: "a" });
    expect(editKey(placements, "c", key("Tab"), sizesOf)).toEqual({ do: "select", id: "a" });
    expect(editKey(placements, "a", key("Tab", false, true), sizesOf)).toEqual({ do: "select", id: "c" });
  });

  test("⌥ arrows move; ⌥⇧ arrows step the size through the sizes it offers; plain arrows do nothing", () => {
    expect(editKey(placements, "b", key("ArrowUp", true), sizesOf)).toEqual({ do: "move", id: "b", to: 0 });
    expect(editKey(placements, "b", key("ArrowDown", true), sizesOf)).toEqual({ do: "move", id: "b", to: 2 });
    expect(editKey(placements, "b", key("ArrowRight", true, true), sizesOf)).toEqual({ do: "resize", id: "b", size: "wide" });
    expect(editKey(placements, "b", key("ArrowLeft", true, true), sizesOf)).toEqual({ do: "resize", id: "b", size: "compact" });
    expect(editKey(placements, "b", key("ArrowDown"), sizesOf)).toEqual({ do: "nothing" });
  });

  test("Delete takes it away; Esc and Return are Done", () => {
    expect(editKey(placements, "c", key("Delete"), sizesOf)).toEqual({ do: "remove", id: "c" });
    expect(editKey(placements, null, key("Escape"), sizesOf)).toEqual({ do: "done" });
  });

  test("the host's key names (GPUI's) are read as the browser's", () => {
    expect(hostKey({ key: "up", alt: true, shift: false })).toEqual(key("ArrowUp", true));
    expect(hostKey({ key: "escape", alt: false, shift: false })).toEqual(key("Escape"));
    expect(editKey(placements, "b", hostKey({ key: "right", alt: true, shift: true }), sizesOf)).toEqual({ do: "resize", id: "b", size: "wide" });
  });

  test("⌥← and ⌥→ arrive as Ctrl← and Ctrl→ (the keymap's word moves) and are read as ⌥; Ctrl on ↑ ↓ is not", () => {
    expect(hostKey({ key: "right", alt: false, shift: true, ctrl: true })).toEqual(key("ArrowRight", true, true));
    expect(hostKey({ key: "left", alt: false, shift: false, ctrl: true })).toEqual(key("ArrowLeft", true));
    expect(hostKey({ key: "down", alt: false, shift: false, ctrl: true })).toEqual(key("ArrowDown"));
  });

  test("the gallery: ↑ ↓ through the list, ← → through the sizes, Return adds, Esc closes; ⌥ arrows are the column's", () => {
    const kinds = ["weather", "timer", "music"];
    expect(galleryKey(kinds, "weather", ["small", "wide"], 0, key("ArrowDown"))).toEqual({ do: "choose", kind: "timer", sizeAt: 0 });
    expect(galleryKey(kinds, "weather", ["small", "wide"], 0, key("ArrowUp"))).toEqual({ do: "choose", kind: "weather", sizeAt: 0 });
    expect(galleryKey(kinds, "weather", ["small", "wide"], 0, key("ArrowRight"))).toEqual({ do: "size", sizeAt: 1 });
    expect(galleryKey(kinds, "weather", ["small", "wide"], 1, key("Enter"))).toEqual({ do: "add", kind: "weather", size: "wide" });
    expect(galleryKey(kinds, "weather", ["small", "wide"], 0, key("Escape"))).toEqual({ do: "close" });
    expect(galleryKey(kinds, "weather", ["small", "wide"], 0, key("ArrowDown", true))).toEqual({ do: "nothing" });
  });

  test("sizes stay inside what a widget offers; the edge handle goes round", () => {
    expect(stepSize(["small", "wide"], "wide", 1)).toBe("wide");
    expect(cycleSize(["small", "compact", "wide"], "wide")).toBe("compact");
    expect(cycleSize(["small", "compact", "wide"], "compact")).toBe("small");
  });

  test("a drag lands before the first widget whose middle is below it", () => {
    const boxes = [
      { id: "a", y: 0, height: 356 },
      { id: "b", y: 368, height: 172 },
      { id: "c", y: 552, height: 172 },
    ];
    expect(dropIndex(boxes, "c", 10)).toBe(0);
    expect(dropIndex(boxes, "a", 700)).toBe(2);
  });

  test("the tag says the size in words, and the step after a resize", () => {
    const weather = DASHI_WIDGETS.find((info) => info.kind === "weather") ?? null;
    expect(tagOf(weather, null, "small")).toBe("Weather · mizu · Small");
    expect(tagOf(weather, "small", "wide")).toBe("Weather · mizu · Small → Wide");
  });
});

describe("the widgets' store", () => {
  test("adds, moves, resizes and removes, and keeps them in a file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "widgets-")), "widgets.json");
    const store = new WidgetStore(path);
    expect(store.getSnapshot().map((each) => each.kind)).toEqual(["rundown", "weather", "battery", "media"]);
    const timer = store.add("timer", "small");
    expect(timer?.id).toBe("w5");
    store.move("w5", 0);
    store.update("w2", { size: "wide" });
    store.remove("w4");
    expect(new WidgetStore(path).getSnapshot().map((each) => `${each.kind}:${each.size}`)).toEqual([
      "timer:small",
      "rundown:large",
      "weather:wide",
      "battery:small",
    ]);
    expect(readFileSync(path, "utf8")).toContain('"widgets"');
  });
});

describe("Weather on air", () => {
  const ok = (rainFrom: number) => ({ status: "ok" as const, now: { place: "Lisbon", temperature: 19, code: 61, high: 21, low: 13, rainFrom, at: 0 } });
  test("only when the person allowed it, and only in the 15 minutes before rain", () => {
    expect(weatherOnAir(ok(1_000_000), false, 1_000_000 - 60_000)).toEqual([]);
    expect(weatherOnAir(ok(1_000_000), true, 1_000_000 - 60_000)[0]).toMatchObject({ reason: "due", deadline: 1_000_000, ink: "mizu" });
    expect(weatherOnAir(ok(1_000_000), true, 1_000_000 - 20 * 60_000)).toEqual([]);
  });
});
