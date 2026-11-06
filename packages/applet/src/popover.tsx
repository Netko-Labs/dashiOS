/**
 * A popover drawn by the applet's own Metal host: a React tree (with
 * @dashi/ui and metal-ui) on a layer-shell surface at the place the shell
 * gave (protocol.ts, `popover`). The shell grants this applet's processes
 * the layer shell while the popover is open and takes it back when it
 * closes; it never runs the applet's code. Dark Mode follows the shell's
 * switch (appearance.ts).
 */

import { setAppearanceSource } from "@dashi/ui";
import { type NativeHostTransport, render, type SurfaceOptions, spawnNativeHost } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { appearance } from "./appearance.ts";
import type { PopoverPlacement } from "./client.ts";
import type { WarmHost } from "./warm-host.ts";

/** The Metal host: the session's (`DASHI_METAL_HOST`, which the sandbox sets), else the installed one. */
export const metalHost = (env: Record<string, string | undefined> = process.env): string => env.DASHI_METAL_HOST ?? "/usr/libexec/dashi/mirin-metal-host";

/** The layer surface for a placement: anchored at the screen's top-left, offset to the place. */
export function popoverSurface(placement: PopoverPlacement): SurfaceOptions {
  return {
    role: "layer",
    layer: "overlay",
    anchor: ["top", "left"],
    // Over everything, not pushed by the menu bar's or the Dock's zones: the shell's numbers are the screen's.
    exclusiveZone: -1,
    margin: { top: placement.y, left: placement.x },
    // It takes the keyboard when clicked (a search field in it), and Esc reaches it.
    keyboard: "on-demand",
    namespace: placement.namespace,
    ...(placement.output === null ? {} : { output: placement.output }),
  };
}

export interface OpenPopover {
  /** Closes it; `onClosed` runs once, however it closed. */
  close(): void;
  host: NativeHostTransport;
}

export interface PopoverWindowOptions {
  appId: string;
  title: string;
  placement: PopoverPlacement;
  element: ReactElement;
  onClosed(): void;
  spawn?: typeof spawnNativeHost;
  /** The applet's warm host, taken when one is ready (warm-host.ts). */
  warm?: WarmHost | null;
}

let connected = false;

/** Opens `element` where the shell placed it. */
export function openPopoverWindow({ appId, title, placement, element, onClosed, spawn = spawnNativeHost, warm = null }: PopoverWindowOptions): OpenPopover {
  if (!connected) {
    connected = true;
    const source = appearance();
    setAppearanceSource({ subscribe: source.subscribe, isDark: source.isDark });
  }
  const shape = { appId, title, width: placement.width, height: placement.height, surface: popoverSurface(placement) };
  // A warm host draws on its first frame; a new one takes a second or two to start. Either is named for screen readers.
  const host = warm?.take(shape) ?? spawn(metalHost(), { ...shape, env: { MIRIN_METAL_APP_NAME: title } });
  const root = render(element, host);
  let open = true;
  const finish = (): void => {
    if (!open) return;
    open = false;
    root.unmount();
    onClosed();
  };
  host.onClose(finish);
  return {
    host,
    close() {
      if (!open) return;
      finish();
      host.close();
    },
  };
}
