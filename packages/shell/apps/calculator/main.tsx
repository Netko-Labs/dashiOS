/**
 * Calculator (dev.dashi.calculator): `bun apps/calculator/main.tsx [host]`.
 * The arithmetic is engine.ts; the display's text is format.ts.
 */

import { runApp } from "../kit/index.ts";
import { CALCULATOR_SIZE, CalculatorWindow } from "./view.tsx";

runApp({ id: "dev.dashi.calculator", title: "Calculator", size: CALCULATOR_SIZE }, <CalculatorWindow />);
