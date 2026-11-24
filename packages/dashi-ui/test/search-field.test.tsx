import { expect, test } from "bun:test";
import { render } from "@mirinjs/metal";
import { OnPanelCard } from "../src/panel/index.ts";
import { SearchField } from "../src/search-field.tsx";
import { DARK_CONTROLS, LIGHT_CONTROLS } from "../src/theme/index.ts";
import { fakeHost } from "./host.ts";
import { settle } from "./support/time.ts";

/** One Esc in a SearchField of `variant` holding "milk": what was typed after, and the keys passed on. */
async function escape(variant?: "search" | "find"): Promise<{ texts: string[]; keys: string[] }> {
  const host = fakeHost();
  const texts: string[] = [];
  const keys: string[] = [];
  const root = render(
    <SearchField testID="field" value="milk" variant={variant} onChangeText={(text) => texts.push(text)} onKeyPress={(key) => keys.push(key)} />,
    host.transport,
  );
  await settle();
  host.emit({ type: "key", nodeId: root.nodeId("field") as string, value: "Escape" });
  await settle();
  root.unmount();
  return { texts, keys };
}

test("a search's first Esc empties it and goes no further", async () => {
  expect(await escape()).toEqual({ texts: [""], keys: [] });
  expect(await escape("search")).toEqual({ texts: [""], keys: [] });
});

test("a find's Esc keeps the query and is passed on at once", async () => {
  expect(await escape("find")).toEqual({ texts: [], keys: ["Escape"] });
});

test("a field with a least width gives way down to it; its status is muted words at its end", async () => {
  const host = fakeHost();
  const root = render(<SearchField testID="find" value="one" width={200} minWidth={120} status="2 of 4" onChangeText={() => {}} />, host.transport);
  await settle();
  expect(host.last()).toContain('"minWidth":120');
  expect(JSON.parse(host.last()).props.shrink).not.toBe(false);
  expect(root.nodeId("find:status")).toBeDefined();
  expect(host.last()).toContain('"2 of 4"');
  root.unmount();
  // Without one it keeps its width, and nothing is said.
  const plain = fakeHost();
  const again = render(<SearchField testID="search" value="" onChangeText={() => {}} />, plain.transport);
  await settle();
  expect(plain.last()).toContain('"width":210');
  expect(plain.last()).toContain('"shrink":false');
  expect(again.nodeId("search:status")).toBeUndefined();
  again.unmount();
});

test("a field that fills its row, made with its words selected", async () => {
  const host = fakeHost();
  const root = render(<SearchField testID="search" look="panel" width="fill" selectAll value="wifi" onChangeText={() => {}} />, host.transport);
  await settle();
  expect(host.last()).toContain('"flex":1');
  expect(host.last()).toContain('"selection":{"start":0,"end":4}');
  root.unmount();
});

test("a picker's search takes its column's whole width", async () => {
  const host = fakeHost();
  const root = render(<SearchField testID="zones" value="" width="fill" onChangeText={() => {}} />, host.transport);
  await settle();
  expect(host.last()).not.toContain('"width":210');
  expect(host.last()).toContain('"alignSelf":"stretch"');
  root.unmount();
});

test("the panel look's field sinks to the window's colour on a card, so it never takes the card's", async () => {
  // A card's ground is the off colour: the field there is the window's, which differs from it in both modes.
  for (const palette of [LIGHT_CONTROLS, DARK_CONTROLS]) expect(palette.window.toLowerCase()).not.toBe(palette.off.toLowerCase());
  const host = fakeHost();
  const field = <SearchField testID="zones" look="panel" value="" width="fill" onChangeText={() => {}} />;
  const bare = render(field, host.transport);
  await settle();
  expect(host.last().toLowerCase()).toContain(`"background":"${LIGHT_CONTROLS.off.toLowerCase()}"`);
  bare.unmount();
  const card = fakeHost();
  const root = render(<OnPanelCard.Provider value={true}>{field}</OnPanelCard.Provider>, card.transport);
  await settle();
  expect(card.last().toLowerCase()).toContain(`"background":"${LIGHT_CONTROLS.window.toLowerCase()}"`);
  expect(card.last().toLowerCase()).not.toContain(`"background":"${LIGHT_CONTROLS.off.toLowerCase()}"`);
  root.unmount();
});
