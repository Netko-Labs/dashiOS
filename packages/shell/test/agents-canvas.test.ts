import { expect, test } from "bun:test";
import type { RunContext } from "../src/agents/context.ts";
import { clickInElement, screenshotElement } from "../src/agents/desktop/canvas.ts";
import { parseCall } from "../src/agents/index.ts";

const TAB = { id: 3, windowId: 1, active: true, title: "Lichess", url: "https://lichess.org/abc", loading: false };

function harness(frame: { top: boolean; frameId: number }) {
  const clicks: unknown[] = [];
  const asked: string[] = [];
  const link = {
    hello: { browserPid: 50 },
    ask: async (method: string) => {
      asked.push(method);
      if (method === "tabs") return { tabs: [TAB], focusedWindow: 1 };
      if (method === "box") return { rect: { x: 100, y: 50, width: 400, height: 400 }, viewport: { width: 1000, height: 800 }, dpr: 2, ...frame, tab: TAB };
      if (method === "shot") return { png: "iVBOR", width: 800, height: 800, dpr: 2, cssWidth: 400, cssHeight: 400 };
      return { target: "cg-board" };
    },
  };
  const ctx = {
    browser: { link: () => link, whenConnected: async () => link, allowSite: async () => true, mayUse: () => true, tab: null },
    status: () => {},
    agent: "claude",
    compositor: {
      windows: async () => [
        {
          id: 9,
          pid: 50,
          appId: "helium",
          title: "Lichess - Helium",
          state: "normal",
          focused: true,
          titleBar: 0,
          frame: { x: 0, y: 0, width: 1000, height: 900 },
        },
      ],
    },
    hands: { send: async (_window: unknown, payload: unknown) => void clicks.push(payload) },
  } as unknown as RunContext;
  return { ctx, clicks, asked };
}

const call = (args: Record<string, unknown>) => {
  const parsed = parseCall({ name: "click_in_element", arguments: args });
  if ("arguments" in parsed || "unknown" in parsed || parsed.name !== "click_in_element") throw new Error(JSON.stringify(parsed));
  return parsed;
};

test("a square of a board is clicked with Dashi's pointer, at its place in the window", async () => {
  const h = harness({ top: true, frameId: 0 });
  // e2 from White's side: file e is the 5th, rank 2 the 7th row from the top.
  const result = await clickInElement(call({ ref: 12, x: 0.5625, y: 0.8125 }), h.ctx);
  expect(result.structuredContent).toEqual({ ref: 12, by: "pointer" });
  // The page fills the window's 1000 points wide and its bottom 800 (the toolbar above): 100 + 225, 100 + 50 + 325.
  expect(h.clicks).toEqual([{ pointer: { x: 325, y: 475 }, action: "click", button: "left" }]);
});

test("inside a frame it falls back to page events, and says some pages ignore them", async () => {
  const h = harness({ top: false, frameId: 4 });
  const result = await clickInElement(call({ ref: 12, x: 0.5, y: 0.5 }), h.ctx);
  expect(result.structuredContent).toEqual({ ref: 12, by: "events" });
  expect(h.asked).toContain("point");
  expect(h.clicks).toEqual([]);
  expect(parseCall({ name: "click_in_element", arguments: { ref: 1, x: 1.5, y: 0 } })).toEqual({ arguments: expect.stringContaining("0 to 1") });
});

test("an element's picture is the image and how to turn its pixels into fractions", async () => {
  const result = await screenshotElement({ name: "screenshot_element", ref: 12, tab: null }, harness({ top: true, frameId: 0 }).ctx);
  expect(result.content[0]).toEqual({ type: "image", data: "iVBOR", mimeType: "image/png" });
  expect(result.content[1]).toMatchObject({ text: expect.stringContaining("÷ 800") });
});
