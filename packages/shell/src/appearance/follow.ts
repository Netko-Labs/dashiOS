/**
 * Dark Mode's reach beyond the shell. The shell's own surfaces repaint from
 * the palette on their own (theme.ts `useColors`); `startAppearance` also
 * tells installed apps, once at startup and on every change of the switch.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { DEFAULT_STYLE, type GtkStyle } from "../shared/appearance/gtk-colors.ts";
import { type AppLook, detectLook, realProbes } from "../shared/appearance/look.ts";
import type { FlagsStore } from "../shared/control-center/flags.ts";
import { hasProgram, type Run, run } from "../system/exec.ts";
import { type AppCommand, appThemeCommands, appThemeGate, type Gate, readCompositorEnviron } from "./apps.ts";
import type { CornerSource } from "./corner-feed.ts";
import { gtkCssPath, syncGtkCss } from "./lib/gtk-css.ts";

export interface AppearanceDeps {
  gate: Gate;
  has: (program: string) => boolean;
  /** A command that failed is `null`; it never throws. */
  run: Run;
  /** What this machine can dress GTK apps with (shared/appearance/look.ts); absent, only the scheme and button layout are set. */
  look?: AppLook;
  /** The window corner radius the GTK CSS follows (corner-feed.ts); absent, the default radius. */
  corners?: CornerSource;
  /** Puts Dashi's colors and window buttons in the user's GTK files (gtk-css.ts); absent, none is written. */
  gtkCss?: (style: GtkStyle) => void;
}

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/** The real session's tools and the gate for this process. */
export function sessionDeps(): AppearanceDeps {
  return {
    gate: appThemeGate({ env: process.env, compositorEnviron: readCompositorEnviron(readText) }),
    has: hasProgram,
    run,
    look: detectLook(realProbes(process.env, process.env.HOME || homedir())),
    gtkCss: (style) => {
      const home = process.env.HOME || homedir();
      const changed = syncGtkCss(style, { 4: gtkCssPath(4, process.env, home), 3: gtkCssPath(3, process.env, home) });
      if (changed.length > 0) console.log(`dashi-shell: colors and window buttons written to ${changed.length} GTK style file(s)`);
    },
  };
}

/**
 * Applies the setting to apps, one change at a time: the commands of a toggle
 * finish before the next toggle's start, so the last switch wins.
 */
export class AppThemeSync {
  private applied: boolean | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: Pick<AppearanceDeps, "has" | "run" | "look">) {}

  /** Resolves when the commands for this value (and any before it) have finished. */
  apply(dark: boolean): Promise<void> {
    if (this.applied === dark) return this.queue;
    this.applied = dark;
    const commands = appThemeCommands(dark, this.deps.has, this.deps.look);
    this.queue = this.queue.then(() => this.runAll(commands));
    return this.queue;
  }

  private async runAll(commands: readonly AppCommand[]): Promise<void> {
    for (const command of commands) {
      let ok = false;
      try {
        ok = (await this.deps.run(command)) !== null;
      } catch {
        // Counted as a failure below.
      }
      // Not fatal: the shell is already dark, and an app may not be installed.
      if (!ok) console.error(`dashi-shell: ${command[0]} did not change an app's appearance`);
    }
  }
}

/**
 * Makes apps follow Control Center's Dark Mode switch and the Appearance
 * setting's corners while the gate is open (apps.ts). The GTK files are
 * rewritten when either changes; the commands run when Dark Mode does.
 * Returns the function that stops following.
 */
export function startAppearance(flags: Pick<FlagsStore, "subscribe" | "getSnapshot">, deps: AppearanceDeps = sessionDeps()): () => void {
  if (!deps.gate.on) {
    console.log(`dashi-shell: apps keep their own appearance (${deps.gate.why})`);
    return () => {};
  }
  const sync = new AppThemeSync(deps);
  let styled: GtkStyle | null = null;
  const follow = () => {
    const dark = flags.getSnapshot().dark;
    const style: GtkStyle = { dark, radius: deps.corners?.getSnapshot() ?? DEFAULT_STYLE.radius };
    try {
      if (styled?.dark !== style.dark || styled.radius !== style.radius) deps.gtkCss?.(style);
      styled = style;
    } catch (error) {
      console.error("dashi-shell: GTK apps keep their own colors and window buttons:", error);
    }
    void sync.apply(dark);
  };
  follow();
  const stops = [flags.subscribe(follow), deps.corners?.subscribe(follow)];
  return () => {
    for (const stop of stops) stop?.();
  };
}
