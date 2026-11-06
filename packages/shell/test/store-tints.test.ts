import { expect, test } from "bun:test";
import { lightColors, TINT_VALUES } from "@dashi/ui";
import { CATEGORY_TINTS } from "../apps/software/glyphs.ts";

test("store categories take Dashi's tints: no shiso, no red", () => {
  for (const tint of Object.values(CATEGORY_TINTS)) {
    expect(TINT_VALUES).toContain(tint);
    expect(tint).not.toBe(lightColors.agent);
    expect(tint).not.toBe(lightColors.critical);
  }
});
