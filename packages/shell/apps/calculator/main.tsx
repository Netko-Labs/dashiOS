/**
 * Calculator (dev.dashi.calculator): `bun apps/calculator/main.tsx [host]`.
 * The line's words are expression.ts and line.ts; the window is view.tsx. It
 * opens at the size it was last left at (with the tape, when that showed),
 * never under the keypad's smallest (LA-3).
 */

import { runApp, type Size } from "../kit/index.ts";
import { MIN_SIZE, openingSize } from "./layout.ts";
import { readRemembered } from "./store.ts";
import { CalculatorWindow } from "./view.tsx";

const remembered = readRemembered();
// The window exists once runApp returns; until then a resize has nothing to ask.
let resize = (_size: Size): void => {};
const app = runApp(
  { id: "dev.dashi.calculator", title: "Calculator", size: openingSize(remembered.size, remembered.showsTape), minSize: MIN_SIZE },
  <CalculatorWindow remembered={remembered} resizeWindow={(size) => resize(size)} />,
);
resize = (size) => app.host.setSize(size.width, size.height);
