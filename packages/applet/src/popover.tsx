/**
 * A popover drawn by the applet's own Metal host: a React tree (with
 * @dashi/ui and metal-ui) on a layer-shell surface at the place the shell
 * gave (protocol.ts, `popover`). The shell grants this applet's processes
 * the layer shell while the popover is open and takes it back when it
 * closes; it never runs the applet's code. Dark Mode follows the shell's
 * switch (appearance.ts).
 */

import { setAppearanceSource, useSurface } from "@dashi/ui";
import { type NativeHostTransport, render, type SurfaceOptions, spawnNativeHost, View } from "@mirinjs/metal";
import type { ReactElement, ReactNode } from "react";
import { appearance } from "./appearance.ts";
import type { PopoverPlacement } from "./client.ts";
import type { WarmHost } from "./warm-host.ts";

/** The Metal host: the session's (`DASHI_METAL_HOST`, which the sandbox sets), else the installed one. */
export const metalHost = (env: Record<string, string | undefined> = process.env): string => env.DASHI_METAL_HOST ?? "/usr/libexec/dashi/mirin-metal-host";

/**
 * Who has the keyboard while it is open: a popover takes it at once, as the
 * shell's own menus do (Esc and the arrows reach it, and a field in it types);
 * a launcher view leaves it to the launcher, which closes it on Esc.
 */
export type PopoverKeyboard = "exclusive" | "on-demand";

/** The layer surface for a placement: anchored at the screen's top-left, offset to the place. */
export function popoverSurface(placement: PopoverPlacement, keyboard: PopoverKeyboard = "exclusive"): SurfaceOptions {
  return {
    role: "layer",
    layer: "overlay",
    anchor: ["top", "left"],
    // Over everything, not pushed by the menu bar's or the Dock's zones: the shell's numbers are the screen's.
    exclusiveZone: -1,
    margin: { top: placement.y, left: placement.x },
    keyboard,
    namespace: placement.namespace,
    ...(placement.output === null ? {} : { output: placement.output }),
  };
}

/** The popover's corner, the shell's own panels' (a sheet's radius). */
export const POPOVER_RADIUS = 12;

/**
 * The ground under every applet's popover: solid, rounded, and clipping the
 * applet's tree to its corners. An applet's own ground may be glass (the
 * launcher's 96% tint was the template's), but a layer surface has no blur
 * behind it, so a window under it ghosted through every row. On this ground
 * any tint the applet lays on top comes out solid.
 */
export function PopoverGround({ children, onEscape }: { children: ReactNode; onEscape?: () => void }) {
  const surface = useSurface();
  return (
    <View
      testID="applet-popover-ground"
      // Esc closes it, as it closes the shell's menus (a key no control in it took).
      {...(onEscape ? { onWindowKeyDown: (event: { key: string }) => event.key === "escape" && onEscape() } : {})}
      style={{ flex: 1, flexDirection: "column", borderRadius: POPOVER_RADIUS, overflow: "hidden", backgroundColor: surface.card }}
    >
      {children}
    </View>
  );
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
  /** A popover takes the keyboard and closes on Esc (the default); a launcher view leaves both to the launcher. */
  keyboard?: PopoverKeyboard;
}

let connected = false;

/** Opens `element` where the shell placed it. */
export function openPopoverWindow({
  appId,
  title,
  placement,
  element,
  onClosed,
  spawn = spawnNativeHost,
  warm = null,
  keyboard = "exclusive",
}: PopoverWindowOptions): OpenPopover {
  if (!connected) {
    connected = true;
    const source = appearance();
    setAppearanceSource({ subscribe: source.subscribe, isDark: source.isDark });
  }
  const shape = { appId, title, width: placement.width, height: placement.height, surface: popoverSurface(placement, keyboard) };
  // A warm host draws on its first frame; a new one takes a second or two to start. Either is named for screen readers.
  const host = warm?.take(shape) ?? spawn(metalHost(), { ...shape, env: { MIRIN_METAL_APP_NAME: title } });
  let open = true;
  const finish = (): void => {
    if (!open) return;
    open = false;
    root.unmount();
    onClosed();
  };
  const close = (): void => {
    if (!open) return;
    finish();
    host.close();
  };
  const root = render(<PopoverGround {...(keyboard === "exclusive" ? { onEscape: close } : {})}>{element}</PopoverGround>, host);
  host.onClose(finish);
  return { host, close };
}
