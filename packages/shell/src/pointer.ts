/**
 * The pointer's size (Settings → Appearance → Pointer size; settings.json
 * `appearance.pointerSize`), in points: 24 is the standard, as on GNOME and
 * KDE. It reaches each place a pointer is drawn:
 *
 * - dashi-comp's own (every Wayland app that names a shape, Dashi's apps
 *   among them): IPC `cursor-size`, drawn that size at every scale.
 * - GTK apps that draw their own: `org.gnome.desktop.interface cursor-size`,
 *   only where the shell may change what apps read (appearance/apps.ts).
 * - X11 apps: `Xcursor.size` in X pixels (xwayland-scale.ts).
 */

import type { AppCommand, Gate } from "./appearance/index.ts";
import type { Compositor } from "./compositor/index.ts";
import type { Run } from "./system/exec.ts";

/** The commands that tell GTK apps the size, for the tools present (`has`). */
export function pointerCommands(size: number, has: (program: string) => boolean): AppCommand[] {
  return has("gsettings") ? [["gsettings", "set", "org.gnome.desktop.interface", "cursor-size", String(size)]] : [];
}

export interface PointerDeps {
  compositor: Pick<Compositor, "cursorSize">;
  /** Whether the shell may change what other apps read (appearance/apps.ts). */
  gate: Gate;
  has: (program: string) => boolean;
  run: Run;
}

/** Applies the size, one change at a time; the same size twice does nothing. */
export class PointerSync {
  private applied: number | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly deps: PointerDeps) {}

  apply(size: number): Promise<void> {
    if (this.applied === size) return this.queue;
    // Every time, the default too: gsettings keeps a size from an earlier session.
    const tellApps = this.deps.gate.on;
    this.applied = size;
    this.queue = this.queue.then(async () => {
      try {
        await this.deps.compositor.cursorSize({ size });
      } catch (error) {
        console.error("dashi-shell: dashi-comp refused the pointer size:", error instanceof Error ? error.message : error);
      }
      if (!tellApps) return;
      for (const command of pointerCommands(size, this.deps.has)) {
        if ((await this.deps.run(command)) === null) console.error(`dashi-shell: ${command[0]} did not set apps' pointer size`);
      }
    });
    return this.queue;
  }
}
