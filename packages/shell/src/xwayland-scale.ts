/**
 * X11 apps' scale. At 1, Xwayland draws X11 apps at logical size and
 * dashi-comp stretches them to the screen's scale: soft on a HiDPI or
 * fractional screen (Steam at 1.75 looked blurry). Here the shell decides
 * Xwayland's scale (IPC `xwayland-scale`): the largest screen scale, so X11
 * apps see the screens in their pixels; then it tells them how big to draw
 * (X resources `Xft.dpi`, `Xcursor.size`, through xrdb). Apps that size
 * themselves from `Xft.dpi` (Chromium, Electron, Steam, Qt, GTK's text) come
 * out sharp at the right size; an app that ignores it draws small. On a
 * screen with a smaller scale than the largest, X11 apps are that much bigger.
 *
 * Settings → Displays → X11 apps (settings.json `appearance.x11Apps`) can
 * say "stretched" instead: Xwayland stays at 1 and every X11 app is the
 * right size, soft, as before. X11 apps read `Xft.dpi` when they start, so
 * a change shows in the ones opened after it. `Xcursor.size` follows the
 * pointer size (pointer.ts).
 */

import type { Compositor, Output } from "./compositor/index.ts";
import { DEFAULT_POINTER_SIZE } from "./pointer.ts";

/** How X11 apps meet a scaled screen: drawn at its pixels, or drawn at 1 and stretched. */
export const X11_SCALINGS = ["sharp", "stretched"] as const;
export type X11Scaling = (typeof X11_SCALINGS)[number];
export const DEFAULT_X11_SCALING: X11Scaling = "sharp";

/** What the person chose that X11 apps hear about. */
export interface XwaylandChoice {
  scaling: X11Scaling;
  /** The pointer's size in points (pointer.ts). */
  pointerSize: number;
}

/** `Xft.dpi` at scale 1. */
const BASE_DPI = 96;

/** Xwayland's scale for these screens: the largest, at least 1. */
export function xwaylandScale(scales: readonly number[]): number {
  return Math.max(1, ...scales.filter((scale) => Number.isFinite(scale) && scale > 0));
}

/** The X resources that tell X11 apps to draw at `scale`, with a pointer of `pointerSize` points. */
export function xResources(scale: number, pointerSize: number = DEFAULT_POINTER_SIZE): string {
  return `Xft.dpi:\t${Math.round(BASE_DPI * scale)}\nXcursor.size:\t${Math.round(pointerSize * scale)}\n`;
}

/** The screens' scales from IPC `outputs`. */
export function outputScales(outputs: readonly Output[]): number[] {
  return outputs.flatMap((output) => (output.enabled ? [output.scale] : []));
}

export interface XwaylandScalingDeps {
  compositor: Pick<Compositor, "outputs" | "xwaylandScale" | "session" | "on">;
  /** Merge X resources into the X server on `display` (xrdb); false if it couldn't. */
  mergeResources?: (display: string, resources: string) => Promise<boolean>;
  /** The person's choice now (settings); absent, sharp with the standard pointer. */
  choice?: () => XwaylandChoice;
}

export interface XwaylandScaling {
  /** The choice changed: apply it. */
  refresh(): void;
  stop(): void;
}

/** Runs `xrdb -nocpp -merge` with the resources on stdin. */
async function xrdbMerge(display: string, resources: string): Promise<boolean> {
  try {
    const child = Bun.spawn(["xrdb", "-nocpp", "-merge"], { env: { ...process.env, DISPLAY: display }, stdin: "pipe", stdout: "ignore", stderr: "pipe" });
    child.stdin.write(resources);
    await child.stdin.end();
    return (await child.exited) === 0;
  } catch {
    return false;
  }
}

/** Keep Xwayland's scale and X resources following the screens and the person's choice. */
export function startXwaylandScaling({
  compositor,
  mergeResources = xrdbMerge,
  choice = () => ({ scaling: DEFAULT_X11_SCALING, pointerSize: DEFAULT_POINTER_SIZE }),
}: XwaylandScalingDeps): XwaylandScaling {
  let applied: { resources: string; display: string } | null = null;
  let running: Promise<void> = Promise.resolve();
  const apply = async (): Promise<void> => {
    const { scaling, pointerSize } = choice();
    const scale = scaling === "stretched" ? 1 : xwaylandScale(outputScales(await compositor.outputs()));
    // Sent even before Xwayland is up: the compositor keeps it for the start.
    await compositor.xwaylandScale({ scale });
    const session = await compositor.session();
    if (session?.xwayland !== "ready" || !session.display) return;
    const resources = xResources(scale, pointerSize);
    if (applied?.resources === resources && applied.display === session.display) return;
    if (await mergeResources(session.display, resources)) applied = { resources, display: session.display };
    else console.error("dashi-shell: X11 apps' scale: xrdb failed; X11 apps keep their size");
  };
  // One at a time, in order: screens and Xwayland can change together.
  const queue = (): void => {
    running = running.then(apply).catch((error) => console.error("dashi-shell: X11 apps' scale:", error instanceof Error ? error.message : error));
  };
  const stop = compositor.on((event) => {
    if (event.event === "outputs-changed") queue();
    // Xwayland started or restarted: its resources are new.
    if (event.event === "session-changed") {
      applied = null;
      queue();
    }
  });
  queue();
  return { refresh: queue, stop };
}
