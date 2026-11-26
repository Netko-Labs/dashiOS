import { describe, expect, test } from "bun:test";
import { GlassPanes, glassSurfaces } from "../src/glass.ts";

describe("the shell's own glass panes (behind DASHI_GLASS)", () => {
  test("off unless named; 1 is the launcher; a list names surfaces", () => {
    expect([...glassSurfaces(undefined)]).toEqual([]);
    expect([...glassSurfaces("0")]).toEqual([]);
    expect([...glassSurfaces("1")]).toEqual(["launcher"]);
    expect([...glassSurfaces("dock, menubar,nope")]).toEqual(["dock", "menubar"]);
  });

  test("a surface's panes are sent when they change, rounded, and never when it is not glass", async () => {
    const sent: unknown[] = [];
    const compositor = {
      glass: async (params: unknown) => {
        sent.push(params);
        return { frosted: true };
      },
    };
    const launcher = new GlassPanes(compositor, "launcher", "dashi.launcher", new Set(["launcher"]));
    launcher.set([{ x: 0.4, y: 0, width: 680.2, height: 400 }], 16);
    launcher.set([{ x: 0, y: 0, width: 680, height: 400 }], 16);
    expect(sent).toHaveLength(1);
    // Its level's look is glass-style's: the pane names only its level.
    expect(sent[0]).toEqual({ namespace: "dashi.launcher", panes: [{ rect: { x: 0, y: 0, width: 680, height: 400 }, radius: 16, level: "regular" }] });
    const dock = new GlassPanes(compositor, "dock", "dashi.dock", new Set(["launcher"]));
    expect(dock.on).toBe(false);
    dock.set("whole", 18);
    expect(sent).toHaveLength(1);
  });
});
