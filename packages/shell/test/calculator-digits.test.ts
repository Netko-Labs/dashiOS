import { expect, test } from "bun:test";
import { fromField } from "../apps/calculator/lib/field.ts";
import { EMPTY_LINE, type Line, typeChar } from "../apps/calculator/lib/line.ts";
import { EN_US } from "../apps/calculator/lib/locale.ts";

const typed = (text: string, from: Line = EMPTY_LINE): Line => [...text].reduce((line, char) => typeChar(line, char, EN_US), from);

test("a number holds 15 digits: a sixteenth is refused wherever it is typed, never swapped for another", () => {
  const full = typed("123456789012345");
  expect(full.text).toBe("123,456,789,012,345");
  // At the end, and in the middle: the number stays the one that was typed.
  expect(typeChar(full, "6", EN_US).text).toBe(full.text);
  const middle = { ...full, selection: { start: 0, end: 0 } };
  expect(typeChar(middle, "9", EN_US).text).toBe(full.text);
  expect(typeChar(middle, "9", EN_US).selection).toEqual(middle.selection);
  // A zero before it holds no digit, and an operator still starts another number.
  expect(typeChar(middle, "0", EN_US).text).toBe(full.text);
  expect(typed("+6", full).text).toBe("123,456,789,012,345 + 6");
  // ⌫ on the operator would join two numbers into one too long: it stays.
  const sum = typed("123456789012345+6");
  const joined = fromField(sum, "123,456,789,012,345  6", EN_US);
  expect(joined.kind === "line" && joined.edited.line.text).toBe(sum.text);
  // After the decimal mark too.
  const fraction = typed("0.123456789012345");
  expect(typeChar(fraction, "6", EN_US).text).toBe(fraction.text);
});
