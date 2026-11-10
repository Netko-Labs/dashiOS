/**
 * The session's mixer: one `pw-dump --monitor`, streams named as the Dock
 * names apps, and changes made with wpctl and pw-metadata, or, on a
 * development run, kept in memory (the host is read, never written).
 */

import { appFor } from "../../apps.ts";
import type { Compositor } from "../../compositor.ts";
import { cachedIcon, type Entry } from "../../entries.ts";
import { type AppIdentity, catalogFrom } from "../../process-apps/index.ts";
import { type App, iconPath } from "../../shared/apps/index.ts";
import { heldControl, pipewireControl } from "./commands.ts";
import { streamOwners } from "./owners.ts";
import { readProcess } from "./proc-look.ts";
import { AppMixer } from "./store.ts";
import { graphOf, type PipeWireWatch, pipewireWatch } from "./watch.ts";

export interface MixerOptions {
  compositor: Pick<Compositor, "windows"> | null;
  /** The Dock's apps, to name a window's app as it does. */
  apps: readonly App[];
  /** The installed apps (app-catalog.ts's list, kept current). */
  entries: () => readonly Entry[];
  installed: (appId: string) => Entry | undefined;
  /** A development run: changes stay in memory. */
  standIn: boolean;
  /** The session's watcher (shared with the outputs and levels); a watcher of its own without it. */
  pipewire?: PipeWireWatch;
}

export function startAppMixer(options: MixerOptions): AppMixer {
  const windows = async (): Promise<ReadonlyMap<number, AppIdentity>> => {
    const list = options.compositor ? await options.compositor.windows() : [];
    // The shell's own windows (Settings) are Dashi's: its sound is never a row.
    return new Map(
      list.flatMap((window) => {
        if (window.pid === null || window.pid === process.pid) return [];
        const entry = options.installed(window.appId);
        const app: AppIdentity = {
          key: entry?.id ?? window.appId,
          name: appFor(options.apps, window, options.installed).name,
          icon: entry?.icon ?? iconPath("generic"),
        };
        return [[window.pid, app] as const];
      }),
    );
  };
  let mixer: AppMixer | null = null;
  const generic = iconPath("generic");
  // An app no entry names gets the icon its stream names, from the icon theme (once per client: owners.ts).
  const icon = (name: string): string | null => {
    const path = cachedIcon(name);
    return path === generic ? null : path;
  };
  const owner = streamOwners({
    catalog: () => catalogFrom(options.entries()),
    read: (pid) => readProcess(pid),
    windows,
    icon,
    onChange: () => mixer?.refresh(),
  });
  mixer = new AppMixer({ graph: graphOf(options.pipewire ?? pipewireWatch()), control: options.standIn ? heldControl() : pipewireControl(), owner });
  mixer.start();
  return mixer;
}
