/**
 * screenshot_element and click_in_element's part in the browser: an
 * element's box (the tab brought to the front of its window first, so the
 * agent's pointer and the tab's picture both reach it), and its picture: the
 * visible tab captured (`tabs.captureVisibleTab`) and cropped to the box on
 * an OffscreenCanvas.
 */

import { ask } from "./frames.ts";

interface Target {
  frameId: number;
  doc: string;
  local: number;
}

export async function boxIn(tab: number, target: Target, picture: boolean): Promise<Record<string, unknown>> {
  await chrome.tabs.update(tab, { active: true });
  return ask(tab, target.frameId, { op: "box", doc: target.doc, ref: target.local, picture });
}

const field = (value: object, key: string): number | null => {
  const found: unknown = Reflect.get(value, key);
  return typeof found === "number" && Number.isFinite(found) ? found : null;
};

/** The box the content script gave, checked. */
function rectOf(value: unknown): { x: number; y: number; width: number; height: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const [x, y, width, height] = ["x", "y", "width", "height"].map((key) => field(value, key));
  return x !== null && x !== undefined && y !== null && y !== undefined && width && height ? { x, y, width, height } : null;
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
};

export async function shotOf(tab: number, target: Target): Promise<Record<string, unknown>> {
  if (target.frameId !== 0) throw new Error("That element is inside a frame: take a window screenshot instead.");
  const box = await boxIn(tab, target, true);
  const rect = rectOf(box.rect);
  if (!rect) throw new Error("The page didn't say where that element is.");
  const dpr = typeof box.dpr === "number" ? box.dpr : 1;
  const { windowId } = await chrome.tabs.get(tab);
  const url = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  const x = Math.max(0, Math.round(rect.x * dpr));
  const y = Math.max(0, Math.round(rect.y * dpr));
  const width = Math.max(1, Math.min(bitmap.width - x, Math.round(rect.width * dpr)));
  const height = Math.max(1, Math.min(bitmap.height - y, Math.round(rect.height * dpr)));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The picture couldn't be cropped.");
  context.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
  const png = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  return { png: toBase64(png), width, height, dpr, cssWidth: rect.width, cssHeight: rect.height };
}
