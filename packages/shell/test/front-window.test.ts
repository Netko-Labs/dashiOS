import { expect, test } from "bun:test";
import { type FrontCandidate, windowToFront } from "../src/front-window.ts";

const window = (id: number, state: FrontCandidate["state"], focused = false) => ({ id, state, focused });

test("an open app's focused window comes forward, else one on screen, else a minimized one", () => {
  expect(windowToFront([window(1, "normal"), window(2, "normal", true)])?.id).toBe(2);
  expect(windowToFront([window(1, "minimized"), window(2, "normal")])?.id).toBe(2);
  // Its only window is minimized (launch_app on Activity Monitor): that one is restored, nothing new starts.
  expect(windowToFront([window(7, "minimized")])?.id).toBe(7);
  expect(windowToFront([window(3, "hidden"), window(4, "minimized")])?.id).toBe(3);
  // Not open: the caller starts it.
  expect(windowToFront([])).toBeUndefined();
});
