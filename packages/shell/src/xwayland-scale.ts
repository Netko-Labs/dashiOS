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
 */

import type { Compositor } from "./compositor.ts";

/** `Xft.dpi` at scale 1, and the cursor size the compositor draws (render/cursor.rs). */
const BASE_DPI = 96;
const BASE_CURSOR = 24;

/** Xwayland's scale for these screens: the largest, at least 1. */
export function xwaylandScale(scales: readonly number[]): number {
  return Math.max(1, ...scales.filter((scale) => Number.isFinite(scale) && scale > 0));
}

/** The X resources that tell X11 apps to draw at `scale`. */
export function xResources(scale: number): string {
  return `Xft.dpi:\t${Math.round(BASE_DPI * scale)}\nXcursor.size:\t${Math.round(BASE_CURSOR * scale)}\n`;
}

/** The screens' scales from IPC `outputs`. */
export function outputScales(value: unknown): number[] {
  if (typeof value !== "object" || value === null || !("outputs" in value) || !Array.isArray(value.outputs)) return [];
  return value.outputs.flatMap((output: unknown) => {
    if (typeof output !== "object" || output === null || !("scale" in output)) return [];
    if ("enabled" in output && output.enabled === false) return [];
    return typeof output.scale === "number" ? [output.scale] : [];
  });
}

export interface XwaylandScalingDeps {
  compositor: Pick<Compositor, "request" | "session" | "on">;
  /** Merge X resources into the X server on `display` (xrdb); false if it couldn't. */
  mergeResources?: (display: string, resources: string) => Promise<boolean>;
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

/** Keep Xwayland's scale and X resources following the screens; returns a stop function. */
export function startXwaylandScaling({ compositor, mergeResources = xrdbMerge }: XwaylandScalingDeps): () => void {
  let applied: { scale: number; display: string } | null = null;
  let running: Promise<void> = Promise.resolve();
  const apply = async (): Promise<void> => {
    const scale = xwaylandScale(outputScales(await compositor.request("outputs")));
    // Sent even before Xwayland is up: the compositor keeps it for the start.
    await compositor.request("xwayland-scale", { scale });
    const session = await compositor.session();
    if (session?.xwayland !== "ready" || !session.display) return;
    if (applied?.scale === scale && applied.display === session.display) return;
    if (await mergeResources(session.display, xResources(scale))) applied = { scale, display: session.display };
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
  return stop;
}
