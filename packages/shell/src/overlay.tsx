/**
 * Opening a Metal overlay surface and closing it again: what menus, sheets,
 * and panels share. A Metal host is a process, so closing one unmounts its
 * tree first (nothing renders into a dying host) and then ends the host; a
 * host that dies by itself is the same close.
 */

import { type NativeHostOptions, type NativeHostTransport, render, spawnNativeHost, TextInput, View } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { METAL_HOST } from "./apps.ts";

export interface OverlayHandle {
  /** Idempotent; also runs `onClosed`. */
  close(): void;
  /**
   * Resolves when the host process has really exited, which is later than
   * `onClosed` (that runs as the close starts). Wait for it before something
   * that must not see the surface, such as a screenshot.
   */
  exited?: Promise<void>;
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
  const host = spawnNativeHost(METAL_HOST, { appId: "dev.dashi.shell", ...options });
  onHost?.(host);
  const root = render(element, host);
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
  };
};

export type NavigationKey = "Escape" | "ArrowUp" | "ArrowDown";

/**
 * Keys for an overlay with nothing to type into. Metal reports Esc, the
 * arrows, and Enter only from a focused text input, so this is an invisible
 * one that never keeps what is typed. Needs the surface to hold the keyboard.
 */
export function KeyCatcher({ onKey, onSubmit }: { onKey: (key: NavigationKey) => void; onSubmit?: () => void }) {
  return (
    <View style={{ position: "absolute", left: 0, top: 0, width: 1, height: 1, opacity: 0, overflow: "hidden" }}>
      <TextInput
        value=""
        autoFocus
        onChangeText={() => {}}
        onKeyPress={onKey}
        onSubmitEditing={() => onSubmit?.()}
        style={{ width: 1, height: 1, backgroundColor: "#00000000" }}
      />
    </View>
  );
}
