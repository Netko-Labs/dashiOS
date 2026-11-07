import { expect, test } from "bun:test";
import { alertButtonsWidth } from "@dashi/ui";
import { scopeSheetWidth } from "../apps/calendar/sheets.tsx";

test("the repeat question is wide enough for its buttons on one row", () => {
  const four = ["Cancel", "This event", "This and following", "All events"];
  // Review 18: "All events" sat alone on a second row of a 460 sheet.
  expect(scopeSheetWidth(four)).toBeGreaterThanOrEqual(alertButtonsWidth(four) + 40);
  expect(scopeSheetWidth(four)).toBeGreaterThan(460);
  // Without "This event" (the repeat itself changed) the three fit as they did.
  expect(scopeSheetWidth(["Cancel", "This and following", "All events"])).toBe(460);
});
