/**
 * The shell's side of the windows on glass (decisions.md D815, D817): drag-to-tile sends how its
 * preview looks (WI-10: thin glass, radius 10, inset 6), and the capture area's wash lies round the
 * area, never over it (GL-6: a capture shows what it takes).
 */

import { describe, expect, test } from "bun:test";
import { GLASS } from "@dashi/ui";
import { DragTiling } from "../src/arrange/lib/drags.ts";
import { washAround } from "../src/screenshots/screenshot-area.tsx";
import { SCREEN, USABLE } from "./support/window-arrange.ts";

describe("the tile preview (WI-10)", () => {
  test("the zones go with the preview's look: thin glass, 10 round, 6 in", async () => {
    const sent: unknown[] = [];
    const steps = { arranged: new Map(), forget: () => {}, frame: async () => {}, frameOf: async () => null, tileIn: async () => {} };
    const tiling = new DragTiling(steps);
    await tiling.send(
      {
        layout: async (params) => {
          sent.push(params);
          return {};
        },
      },
      [{ name: "Virtual-1", frame: SCREEN, usable: USABLE, scale: 1 }],
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ preview: { level: "thin", radius: 10, inset: 6 } });
    expect(GLASS.tilePreview).toEqual({ level: "thin", radius: 10, inset: 6 });
  });
});

describe("the capture area (GL-6)", () => {
  test("the wash's four bands meet the area's edges and leave it clear", () => {
    const bands = Object.fromEntries(washAround({ x: 200, y: 100, width: 540, height: 320 }).map(({ key, ...band }) => [key, band]));
    expect(bands.above).toEqual({ left: 0, right: 0, top: 0, height: 100 });
    expect(bands.below).toEqual({ left: 0, right: 0, top: 420, bottom: 0 });
    expect(bands.left).toEqual({ left: 0, top: 100, width: 200, height: 320 });
    expect(bands.right).toEqual({ left: 740, right: 0, top: 100, height: 320 });
  });
});
