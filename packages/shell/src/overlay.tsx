/**
 * Opening a Metal overlay surface and closing it again: what menus, sheets,
 * and panels share. A Metal host is a process, so closing one unmounts its
 * tree first (nothing renders into a dying host) and then ends the host; a
 * host that dies by itself is the same close.
 */

import { KeySink, TextSelectionLook } from "@dashi/ui";
import { type NativeHostOptions, type NativeHostTransport, render } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { METAL_HOST } from "./shared/apps/index.ts";
import { hostTakesLeast, spawnShellHost, WarmHost, windowFor } from "./shared/metal/index.ts";

/** The spare host overlays open on (shared/metal/host.ts). */
const warmHost = new WarmHost(METAL_HOST);
/** Whether its `open` takes a least size; until that is known, it isn't sent. */
let takesLeast = false;
void hostTakesLeast(METAL_HOST)
  .then((ok) => {
    takesLeast = ok;
  })
  .catch(() => {});

export interface OverlayHandle {
  /** Idempotent; also runs `onClosed`. */
  close(): void;
  /**
   * Resolves when the host process has really exited, which is later than
   * `onClosed` (that runs as the close starts). Wait for it before something
   * that must not see the surface, such as a screenshot.
   */
  exited?: Promise<void>;
  /** Scroll the scroll view with this testID by `dy` points (down is positive), as a wheel would (settings-app/spot.tsx). */
  scroll?(testID: string, dy: number): void;
}

/**
 * Opens `element` on a new host; `onClosed` runs once, however it closed.
 * `onHost` gets the host as soon as it exists (to follow what it reports, as
 * the menu bar's host does with the windows).
 */
export type OpenOverlay = (
  options: NativeHostOptions,
  element: ReactElement,
  onClosed?: () => void,
  onHost?: (host: NativeHostTransport) => void,
) => OverlayHandle;

export const openOverlay: OpenOverlay = (options, element, onClosed, onHost) => {
  // Plain overlays take the warm host; one that needs more of a host gets its own.
  const plain = options.capabilities === undefined && options.env === undefined && options.onStderr === undefined;
  const window = { appId: "dev.dashi.shell", ...windowFor(options, takesLeast) };
  const host = (plain ? warmHost.take(window) : null) ?? spawnShellHost({ appId: "dev.dashi.shell", ...options });
  onHost?.(host);
  const root = render(<TextSelectionLook>{element}</TextSelectionLook>, host);
  let open = true;
  const finish = () => {
    if (!open) return;
    open = false;
    root.unmount();
    onClosed?.();
  };
  host.onClose(finish);
  const exited = new Promise<void>((resolve) => host.onClose(resolve));
  return {
    exited,
    close() {
      if (!open) return;
      finish();
      host.close();
    },
    scroll(testID, dy) {
      const id = open ? root.nodeId(testID) : undefined;
      if (id !== undefined) host.simulate({ kind: "scroll", id, dy });
    },
  };
};

export type NavigationKey = "Escape" | "ArrowUp" | "ArrowDown";

/**
 * Keys for an overlay with nothing to type into: the kit's KeySink, which
 * hears the window's keys while no field has the keyboard (Metal's
 * `onWindowKeyDown`). Esc and the arrows go to `onKey`, Return to
 * `onSubmit`. Needs the surface to hold the keyboard.
 */
export function KeyCatcher({ onKey, onSubmit, testID }: { onKey: (key: NavigationKey) => void; onSubmit?: () => void; testID?: string }) {
  return (
    <KeySink
      {...(testID ? { testID } : {})}
      onKey={(key) => {
        if (key.kind === "escape") onKey("Escape");
        else if (key.kind === "up") onKey("ArrowUp");
        else if (key.kind === "down") onKey("ArrowDown");
        else if (key.kind === "enter") onSubmit?.();
      }}
    />
  );
}
