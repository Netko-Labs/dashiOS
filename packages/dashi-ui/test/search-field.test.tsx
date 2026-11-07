import { expect, test } from "bun:test";
import { render } from "@mirinjs/metal";
import { SearchField } from "../src/fields.tsx";
import { fakeHost, settle } from "./host.ts";

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
