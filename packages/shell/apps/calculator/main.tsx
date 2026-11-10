/**
 * Calculator (dev.dashi.calculator): `bun apps/calculator/main.tsx [host]`.
 * The line's words are expression.ts and line.ts; the window is view.tsx. It
 * opens at the size it was last left at (with the tape, when that showed),
 * never under the keypad's smallest, with the tape's room while it shows (LA-3).
 */

import { runApp, type Size } from "../kit/index.ts";
import { leastSize, openingSize } from "./lib/layout.ts";
import { readRemembered } from "./lib/store.ts";
import { CalculatorWindow } from "./lib/view.tsx";

const remembered = readRemembered();
// The window exists once runApp returns; until then a resize has nothing to ask.
let resize = (_size: Size, _least: Size): void => {};
const app = runApp(
  {
    id: "dev.dashi.calculator",
    title: "Calculator",
    size: openingSize(remembered.size, remembered.showsTape),
    minSize: leastSize(remembered.showsTape),
    // ❖V is the app's Paste (one reader for every paste), and ❖A ❖C ❖X its rows: the line always has the keyboard.
    textChordsToFields: false,
  },
  <CalculatorWindow remembered={remembered} resizeWindow={(size, least) => resize(size, least)} />,
);
resize = (size, least) => {
  // The least size first: the host applies it before the size either way.
  app.host.setMinSize(least.width, least.height);
  app.host.setSize(size.width, size.height);
};
