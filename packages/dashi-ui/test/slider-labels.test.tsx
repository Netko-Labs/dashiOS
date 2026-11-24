// What a screen reader reads for a slider's stops (KB-1): plain numbers, never a float's noise.
import { expect, test } from "bun:test";
import { Slider } from "../src/slider.tsx";
import { noop } from "./support/controls-view.ts";
import { fakeClockEachTest } from "./support/time.ts";
import { sent } from "./support/tree.ts";

fakeClockEachTest();

test("Slider: every stop a screen reader reads is a plain number (15%, never 0.15000000000000002)", async () => {
  const { json, root } = await sent(<Slider testID="level" value={0.3} onChange={noop} />);
  const labels = [...json().matchAll(/"label":"([^"]*)"/g)].map((match) => match[1] ?? "");
  expect(labels).toContain("15%");
  expect(labels).toContain("30%");
  for (const label of labels) expect(label).not.toMatch(/0000000/);
  root.unmount();
});
