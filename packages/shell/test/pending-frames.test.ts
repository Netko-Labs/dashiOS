import { expect, test } from "bun:test";
import { PendingFrames } from "../src/pending-frames.ts";

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

test("the size asked for counts until the app draws it; where the window is comes from the compositor", () => {
  const pending = new PendingFrames();
  expect(pending.frameOf(7, rect(1, 2, 3, 4))).toEqual(rect(1, 2, 3, 4));
  pending.asked(7, rect(443, 228, 760, 508));
  // Moved at once, still drawn at the last tile's size.
  expect(pending.frameOf(7, rect(443, 228, 1634, 445))).toEqual(rect(443, 228, 760, 508));
  // Dragged on meanwhile: the place is the compositor's.
  expect(pending.frameOf(7, rect(500, 300, 1634, 445))).toEqual(rect(500, 300, 760, 508));
  // Drawn: from now on what it reports, an app that sizes itself included.
  expect(pending.frameOf(7, rect(500, 300, 760, 508))).toEqual(rect(500, 300, 760, 508));
  expect(pending.frameOf(7, rect(500, 300, 900, 700))).toEqual(rect(500, 300, 900, 700));
});

test("forgetting (a resize by hand, a window closed) trusts the compositor again", () => {
  const pending = new PendingFrames();
  pending.asked(7, rect(0, 28, 1646, 838));
  pending.forget(7);
  expect(pending.frameOf(7, rect(6, 34, 700, 500))).toEqual(rect(6, 34, 700, 500));
});
