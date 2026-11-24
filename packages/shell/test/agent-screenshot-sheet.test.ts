/**
 * A sheet waiting for the person is blanked in an agent's picture (mask.ts):
 * the screenshot's words say what the grey block is, so neither an agent nor
 * a person reading its pictures takes it for a sheet that failed to draw
 * (the installed pass of 24 Nov, 22-fix-installed).
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunContext } from "../src/agents/context.ts";
import { pictureNote, screenHandlers } from "../src/agents/lib/run/run-screen.ts";

let runtime = "";
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.XDG_RUNTIME_DIR;
  runtime = mkdtempSync(join(tmpdir(), "dashi-screenshot-"));
  process.env.XDG_RUNTIME_DIR = runtime;
});
afterEach(() => {
  if (saved === undefined) delete process.env.XDG_RUNTIME_DIR;
  else process.env.XDG_RUNTIME_DIR = saved;
  rmSync(runtime, { recursive: true, force: true });
});

function context(sheetUp: boolean): RunContext {
  return {
    mask: { update: async () => {} },
    status: () => {},
    ui: { sheetUp: () => sheetUp },
    compositor: {
      capture: async ({ path }: { path: string }) => {
        writeFileSync(path, "png");
        return { width: 1922, height: 1201, scale: 1.75 };
      },
    },
  } as unknown as RunContext;
}

const words = async (sheetUp: boolean): Promise<string> => {
  const result = await screenHandlers.screenshot({ name: "screenshot", window: null }, context(sheetUp));
  const text = result.content.find((part) => part.type === "text");
  return text?.type === "text" ? text.text : "";
};

describe("an agent's screenshot while a sheet waits for the person", () => {
  test("says the grey block is that sheet, blanked, and the person's to answer", async () => {
    const text = await words(true);
    expect(text).toContain("divide pixel positions by 1.75");
    expect(text).toContain("The grey block is a Dashi sheet waiting for the person");
    expect(text).toContain("agents can't press it");
  });

  test("says only the measure when no sheet is up", async () => {
    expect(await words(false)).toBe("1922×1201 pixels at scale 1.75: divide pixel positions by 1.75 for points.");
  });

  test("a window's own picture never holds the sheet, so it never mentions one", () => {
    expect(pictureNote({ width: 10, height: 20 }, 2, false)).toBe("10×20 pixels at scale 2: divide pixel positions by 2 for points.");
  });
});
