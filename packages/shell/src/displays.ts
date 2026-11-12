/**
 * Each screen's scale when nobody chose one: a sharp laptop panel or a 4K
 * monitor shouldn't come up with everything tiny. Bun picks it from the
 * screen's pixel density (`defaultScale`, @dashi/ui: the login screen uses it too) and asks dashi-comp (IPC `output {name, scale}`)
 * once per screen, the first time that screen is seen in this session.
 * A screen that reports no physical size (a projector, a VM) stays at 1.
 *
 * A scale the person chose in System Settings (settings.json `displays`) wins
 * over the computed one; `saved` says which, by screen name.
 */

import { defaultScale, SCALES } from "@dashi/ui";
import type { Compositor, Frame, Output } from "./compositor/index.ts";
import { seenSize } from "./compositor/outputs.ts";
import { monitorsOf, type VrrMode } from "./display-config/monitors.ts";
import { toWire } from "./display-config/plan.ts";

export interface ScreenInfo {
  name: string;
  /** Pixels, the current mode as it looks (a screen turned on its side is taller than wide). */
  width: number;
  height: number;
  /** Millimeters; 0 when the screen doesn't say. */
  widthMm: number;
  heightMm: number;
  scale: number;
  /** Where the screen sits and how big it is in points (pixels over scale); absent if the compositor did not say. */
  frame?: Frame;
}

/**
 * The least room (points) a scale someone else picks may leave. Below it the
 * shell's own sheets (the consent sheet is 500 wide) and the Dock stop
 * fitting, and with no settings window yet there is no way back.
 */
const MIN_USABLE = { width: 800, height: 500 } as const;

/**
 * Whether the screen keeps enough room at `scale` for the shell to be usable.
 * Scale 1 always does: no screen is smaller than its own pixels, and it is
 * the way back from any other.
 */
export function leavesRoom(screen: Pick<ScreenInfo, "width" | "height">, scale: number): boolean {
  return scale <= 1 || (screen.width / scale >= MIN_USABLE.width && screen.height / scale >= MIN_USABLE.height);
}

/** The offered scales this screen can take. */
export function scalesFor(screen: Pick<ScreenInfo, "width" | "height">): number[] {
  return SCALES.filter((scale) => leavesRoom(screen, scale));
}

/** The screens with a desktop of their own, as a person sees them. */
export function screensOf(outputs: readonly Output[]): ScreenInfo[] {
  return outputs.flatMap((output): ScreenInfo[] => {
    // A monitor that is plugged in but off shows nothing, and one that mirrors another shows that one: not a screen of its own.
    if (!output.enabled || output.mirrorOf !== null) return [];
    const seen = seenSize(output);
    if (!seen) return [];
    return [{ name: output.name, ...seen, scale: output.scale, ...(output.frame ? { frame: output.frame } : {}) }];
  });
}

/**
 * The scale a screen comes up with: the one the person chose, else the
 * default for its density. A saved scale goes through the same room check as
 * a chosen one: settings.json is a file anyone can edit, and a screen that
 * was swapped for a smaller one must not come up too big to use.
 */
export function initialScale(screen: ScreenInfo, saved: (name: string) => number | undefined): number {
  const chosen = saved(screen.name);
  return chosen !== undefined && leavesRoom(screen, chosen) ? chosen : defaultScale(screen);
}

/**
 * Give each newly seen screen its saved or default scale, now and whenever
 * screens change. Returns a stop function.
 */
export function startDisplays(
  compositor: Pick<Compositor, "outputs" | "outputsConfig" | "output" | "on">,
  saved: (name: string) => number | undefined = () => undefined,
  savedVrr: (name: string) => VrrMode | undefined = () => undefined,
): () => void {
  const seen = new Set<string>();
  const apply = async () => {
    const outputs = await compositor.outputs();
    const screens = screensOf(outputs);
    const monitors = monitorsOf(outputs);
    for (const screen of screens) {
      if (seen.has(screen.name)) continue;
      seen.add(screen.name);
      const vrr = savedVrr(screen.name);
      const monitor = monitors.find((candidate) => candidate.name === screen.name);
      if (vrr && monitor?.vrr.supported && monitor.vrr.mode !== vrr) {
        await compositor.outputsConfig(toWire({ outputs: [{ name: screen.name, vrr }] }));
        console.log(`dashi-shell: ${screen.name} variable refresh rate ${vrr}`);
      }
      const scale = initialScale(screen, saved);
      if (scale === screen.scale) continue;
      await compositor.output({ name: screen.name, scale });
      console.log(`dashi-shell: ${screen.name} at scale ${scale}`);
    }
  };
  const run = () => void apply().catch((error) => console.error("dashi-shell: could not scale the screens:", error));
  run();
  return compositor.on((event) => {
    if (event.event === "outputs-changed") run();
  });
}
