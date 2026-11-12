import { expect, test } from "bun:test";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { layoutName, layoutWords, variantWords } from "../src/settings-app/layouts.ts";
import { BLANK_CHOICES, BLANK_COMMON, blankChoice, SLEEP_CHOICES, SLEEP_COMMON, timePills } from "../src/settings-app/lib/controls.ts";
import { findSettings } from "../src/settings-app/lib/find.ts";
import { chargeLimitTitle } from "../src/settings-app/lib/panes/battery-laptop.tsx";
import { SETTINGS_ROWS } from "../src/settings-app/registry/index.ts";
import { FOLD_PAST, foldChoices, moreMenuOrigin } from "../src/shared/controls/fold.ts";
import { settle } from "./support/time.ts";

// The settings polish (47-settings-roast): folded pill rows, the charge limit's title, one search result per setting,
// and the keyboard layout's one name.

// ── Four + More ────────────────────────────────────────────────────────────

interface Node {
  props: { id?: string };
  children?: Node[];
}
const findById = (node: Node, id: string): Node | undefined =>
  node.props.id === id
    ? node
    : (node.children ?? []).map((child) => (typeof child === "object" && child !== null && "props" in child ? findById(child, id) : undefined)).find(Boolean);

const seven = ["a", "b", "c", "d", "e", "f", "g"].map((value) => ({ value, label: value.toUpperCase() }));

test("a pill row of five or fewer shows every choice; past five, four and More", () => {
  const five = seven.slice(0, FOLD_PAST);
  expect(foldChoices(five, "e")).toEqual({ shown: five, more: false });
  expect(foldChoices(seven, "b")).toEqual({ shown: seven.slice(0, 4), more: true });
  // The commonest, named, in the list's order whatever order they are named in.
  expect(foldChoices(seven, "c", ["g", "c", "e", "a"]).shown.map((pill) => pill.value)).toEqual(["a", "c", "e", "g"]);
});

test("a hidden value in use takes the fourth pill's place, so the row always shows what is set", () => {
  const fold = foldChoices(seven, "f", ["a", "b", "c", "d"]);
  expect(fold.shown.map((pill) => pill.value)).toEqual(["a", "b", "c", "f"]);
  expect(fold.more).toBe(true);
  // A value the list doesn't have changes nothing.
  expect(foldChoices(seven, "z", ["a", "b", "c", "d"]).shown.map((pill) => pill.value)).toEqual(["a", "b", "c", "d"]);
});

test("the timers show their four usual times; 20 minutes, set, stands fourth", () => {
  const blank = timePills(BLANK_CHOICES);
  expect(foldChoices(blank, blankChoice(300), BLANK_COMMON).shown.map((pill) => pill.label)).toEqual(["2 min", "5 min", "10 min", "Never"]);
  expect(foldChoices(blank, blankChoice(1200), BLANK_COMMON).shown.map((pill) => pill.label)).toEqual(["2 min", "5 min", "10 min", "20 min"]);
  const sleep = timePills(SLEEP_CHOICES);
  expect(foldChoices(sleep, 0, SLEEP_COMMON).shown.map((pill) => pill.label)).toEqual(["15 min", "30 min", "1 h", "Never"]);
  expect(foldChoices(sleep, 7200, SLEEP_COMMON).shown.map((pill) => pill.label)).toEqual(["15 min", "30 min", "1 h", "2 h"]);
});

test("More opens every choice in Dashi's menu, and a hidden one picked there takes the fourth pill", async () => {
  const { TooltipLayer } = await import("@dashi/ui");
  const { View } = await import("@mirinjs/metal");
  const { FoldedChoices } = await import("../src/shared/controls/folded.tsx");
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  let value = "a";
  const tree = () => (
    <View style={{ position: "relative" }}>
      <TooltipLayer>
        <FoldedChoices testID="timer" options={seven} common={["a", "b", "c", "d"]} value={value} onChange={(next) => void (value = next)} />
      </TooltipLayer>
    </View>
  );
  const root = render(tree(), transport);
  await settle();
  const send = async (event: NativeEvent) => {
    for (const listener of listeners) listener(event);
    await settle();
  };
  expect(root.nodeId("timer:f")).toBeUndefined();
  // "More" is the last pill in the pills' own track, on their line: no link beside it.
  const track = JSON.parse(root.lastTree() ?? "{}") as Node;
  const pills = (findById(track, root.nodeId("timer") ?? "")?.children ?? []).map((pill) => pill.props.id);
  expect(pills.at(-1)).toBe(root.nodeId("timer:more"));
  expect(root.lastTree()).not.toContain("underline");
  expect(root.lastTree()).not.toContain("More…");
  // A press carries the pill's bounds: the menu opens under the track, in the window's top layer.
  await send({ type: "press", nodeId: root.nodeId("timer:more") ?? "", bounds: { x: 600, y: 140, width: 64, height: 32 } });
  expect(root.nodeId("timer:menu:away")).toBeDefined();
  const rows = (root.lastTree() ?? "").match(/"G"/g) ?? [];
  expect(rows.length).toBeGreaterThan(0);
  root.unmount();
  value = "f";
  const again = render(tree(), transport);
  await settle();
  expect(again.nodeId("timer:f")).toBeDefined();
  expect(again.nodeId("timer:d")).toBeUndefined();
  again.unmount();
});

test("More's menu hangs under the track by its right edge, under the pill's", () => {
  // The pill ends the row: opened at its left, the menu ran off the window and flipped away from it.
  const pill = { x: 600, y: 140, width: 64, height: 32 };
  // Under the track (4 of padding) with 4 of air; its right edge (anchor "end") under the pill's.
  expect(moreMenuOrigin(pill)).toEqual({ x: pill.x + pill.width, y: pill.y + pill.height + 8 });
});

// ── The charge limit ───────────────────────────────────────────────────────

test("the charge limit's title names the limit it is at, never an old one", () => {
  expect(chargeLimitTitle(80)).toBe("Stop charging at 80%");
  // The slider moving: the title follows each value, before it is saved.
  for (const limit of [75, 60, 55]) expect(chargeLimitTitle(limit)).toBe(`Stop charging at ${limit}%`);
  // Full: the switch is off and says what it would do.
  expect(chargeLimitTitle(100)).toBe("Stop charging early");
});

// ── Search ─────────────────────────────────────────────────────────────────

test("search lists each setting once, with its own glyph and its pane", () => {
  const night = findSettings("night");
  const ids = night.map((found) => found.id);
  expect(ids.filter((id) => id.startsWith("displays/night-shift"))).toEqual(["displays/night-shift"]);
  expect(night[0]).toMatchObject({ id: "displays/night-shift", where: "Displays" });
  // The row's own glyph, not the pane's monitor.
  expect(night[0]?.glyph).toBe(SETTINGS_ROWS.find((row) => row.id === "displays/night-shift")?.glyph);
  // A part is found when the words find it and not its setting.
  expect(findSettings("warmth").map((found) => found.id)).toContain("displays/night-shift-warmth");
  // No setting is listed twice, whatever is typed.
  for (const query of ["night", "charge", "battery", "sound", "scroll", "dark", "display"]) {
    const found = findSettings(query);
    const settings = found.map((each) => SETTINGS_ROWS.find((row) => row.id === each.id)?.partOf ?? each.id);
    expect([query, settings.length]).toEqual([query, new Set(settings).size]);
  }
  // A pane and its own switch of the same name are one result.
  expect(findSettings("bluetooth").filter((found) => found.label === "Bluetooth")).toHaveLength(1);
});

// ── The keyboard layout's one name ─────────────────────────────────────────

test("the layout has one name: the variant's own when one is chosen", () => {
  const xkb = {
    layouts: [{ id: "us", name: "English (US)" }],
    variants: [{ id: "euro", layout: "us", name: "English (US, euro on 5)" }],
  };
  expect(layoutName(xkb, "us", undefined)).toBe("English (US)");
  expect(layoutName(xkb, "us", "euro")).toBe("English (US, euro on 5)");
  expect(layoutName(xkb, undefined, undefined)).toBe("English (US)");
  // Recently changed says it by the same name, not its id.
  expect(layoutWords("us", xkb)).toBe("English (US)");
  expect(variantWords(undefined, "euro", xkb)).toEqual({ from: "English (US)", to: "English (US, euro on 5)" });
  expect(variantWords("euro", undefined, xkb)).toEqual({ from: "English (US, euro on 5)", to: "English (US)" });
  expect(layoutWords("zz", xkb)).toBe("zz");
});
