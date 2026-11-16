/**
 * click_in_element and screenshot_element (tools/lib/canvas.ts): for page
 * elements with nothing inside to read, like a chess board drawn by script.
 * A point of the element (fractions of its box) is clicked with the agent's
 * own pointer in the browser's window, a real click the page can't tell from
 * the person's; inside a frame, where the box can't be placed in the window,
 * by page events (which some pages ignore). Its picture is the visible tab,
 * cropped to the element by the extension; never one with a secret field in it.
 */

import { isRecord } from "@dashi/shape";
import type { BrowserLink } from "../../browser/bridge.ts";
import { parseTab, type TabInfo } from "../../browser/index.ts";
import { type RunContext, type ToolResult, text, toolError } from "../context.ts";
import type { Call } from "../tools/index.ts";
import { onPage } from "./browser.ts";
import { browserWindowFor, viewportToWindow } from "./lib/browser-field.ts";

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

async function pointerClick(link: BrowserLink, tab: TabInfo, box: Record<string, unknown>, fx: number, fy: number, ctx: RunContext): Promise<string | null> {
  if (box.top !== true || box.frameId !== 0 || !isRecord(box.rect) || !isRecord(box.viewport)) return null;
  const window = browserWindowFor(await ctx.compositor.windows(), link.hello.browserPid, parseTab(box.tab) ?? tab);
  if (!window) return null;
  const rect = { x: num(box.rect.x) + fx * num(box.rect.width), y: num(box.rect.y) + fy * num(box.rect.height), width: 0, height: 0 };
  const content = { width: window.frame?.width ?? 0, height: (window.frame?.height ?? 0) - window.titleBar };
  const point = viewportToWindow(rect, { width: num(box.viewport.width), height: num(box.viewport.height) }, content);
  if (!point) return null;
  await ctx.hands.send(window, { pointer: { x: Math.round(point.x), y: Math.round(point.y) }, action: "click", button: "left" }, ctx.agent, ctx.status);
  return `w${window.id} at ${Math.round(point.x)}, ${Math.round(point.y)}`;
}

export async function clickInElement(call: Extract<Call, { name: "click_in_element" }>, ctx: RunContext): Promise<ToolResult> {
  return onPage(ctx, call.tab, "Clicking on", async (link, tab) => {
    const box = await link.ask("box", { tab: tab.id, ref: call.ref });
    const where = `${Math.round(call.x * 100)}% across, ${Math.round(call.y * 100)}% down`;
    const clicked = await pointerClick(link, tab, box, call.x, call.y, ctx);
    if (clicked)
      return text(`Clicked [${call.ref}] ${where}, with Dashi's pointer (${clicked}). screenshot_element shows what it did.`, { ref: call.ref, by: "pointer" });
    const result = await link.ask("point", { tab: tab.id, ref: call.ref, x: call.x, y: call.y });
    return text(
      `Clicked [${call.ref}] ${where} by page events on its ${String(result.target ?? "element")} (it is in a frame, or its window couldn't be placed): some pages ignore those. screenshot_element shows what it did.`,
      { ref: call.ref, by: "events" },
    );
  });
}

export async function screenshotElement(call: Extract<Call, { name: "screenshot_element" }>, ctx: RunContext): Promise<ToolResult> {
  return onPage(ctx, call.tab, "Looking at", async (link, tab) => {
    const shot = await link.ask("shot", { tab: tab.id, ref: call.ref });
    if (typeof shot.png !== "string") return toolError("The browser gave no picture.");
    const dpr = num(shot.dpr) || 1;
    return {
      content: [
        { type: "image", data: shot.png, mimeType: "image/png" },
        {
          type: "text",
          text: `[${call.ref}]: ${num(shot.width)}×${num(shot.height)} pixels, ${Math.round(num(shot.cssWidth))}×${Math.round(num(shot.cssHeight))} on the page (scale ${dpr}). A point's fractions for click_in_element are its pixel x ÷ ${num(shot.width)} and y ÷ ${num(shot.height)}.`,
        },
      ],
    };
  });
}
