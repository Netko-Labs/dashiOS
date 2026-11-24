import { expect, test } from "bun:test";
import type { NativeEvent } from "@mirinjs/metal";
import { drawsDisplay } from "../src/display.ts";

const protocol = (says: { fontWeights?: boolean; displayFont?: boolean }): NativeEvent => ({ type: "protocol", nodeId: "root", patches: 1, ...says });

test("the clock is ExtraLight only on a host that says both abilities (D670)", () => {
  expect(drawsDisplay(protocol({ fontWeights: true, displayFont: true }))).toBe(true);
  expect(drawsDisplay(protocol({ fontWeights: true }))).toBe(false);
  expect(drawsDisplay(protocol({}))).toBe(false);
  expect(drawsDisplay({ type: "press", nodeId: "1" } as NativeEvent)).toBeNull();
});
