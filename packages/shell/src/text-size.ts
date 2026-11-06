/**
 * Text size (Settings › Appearance › Text size; settings.json
 * `appearance.textSize`): 1, 1.15, 1.3 or 1.5 times the standard type. It
 * reaches:
 *
 * - the shell's own surfaces, through @dashi/ui's text-size source
 *   (`useTextSize`): the launcher's field and rows grow with it, and fewer
 *   rows fit (launcher/measures.ts), so nothing is clipped;
 * - GTK apps: `org.gnome.desktop.interface text-scaling-factor`, only where
 *   the shell may change what apps read (appearance/apps.ts), as the
 *   pointer's size does (pointer.ts).
 */

import { DEFAULT_TEXT_SIZE, setTextSizeSource } from "@dashi/ui";
import type { AppCommand, Gate } from "./appearance/apps.ts";
import type { Run } from "./system/exec.ts";

/** The commands that tell GTK apps the factor, for the tools present (`has`). */
export function textSizeCommands(size: number, has: (program: string) => boolean): AppCommand[] {
  return has("gsettings") ? [["gsettings", "set", "org.gnome.desktop.interface", "text-scaling-factor", String(size)]] : [];
}

export interface TextSizeDeps {
  /** Whether the shell may change what other apps read (appearance/apps.ts). */
  gate: Gate;
  has: (program: string) => boolean;
  run: Run;
}

/** The size the shell's surfaces draw at, and what GTK apps hear; the same size twice does nothing. */
export class TextSize {
  private size = DEFAULT_TEXT_SIZE;
  private told: number | null = null;
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: TextSizeDeps | null) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly textSize = (): number => this.size;

  /** Make it the source @dashi/ui's `useTextSize` reads. */
  connect(): this {
    setTextSizeSource(this);
    return this;
  }

  apply(size: number): Promise<void> {
    if (size !== this.size) {
      this.size = size;
      for (const listener of this.listeners) listener();
    }
    const deps = this.deps;
    // Every time once, the default too: gsettings keeps a factor from an earlier session.
    if (!deps || this.told === size) return this.queue;
    this.told = size;
    if (!deps.gate.on) return this.queue;
    this.queue = this.queue.then(async () => {
      for (const command of textSizeCommands(size, deps.has)) {
        if ((await deps.run(command)) === null) console.error(`dashi-shell: ${command[0]} did not set apps' text size`);
      }
    });
    return this.queue;
  }
}
