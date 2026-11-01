/**
 * Putting the authentication sheet on screen: one at a time, centered, on an
 * overlay surface that holds the keyboard until it is answered (the same kind
 * as the Wi-Fi password and power sheets).
 */

import type { OpenOverlay, OverlayHandle } from "../overlay.tsx";
import type { Presenter } from "./controller.ts";
import type { SheetActions, SheetStore } from "./model.ts";
import { PolkitSheet, sheetSize } from "./sheet.tsx";

export class PolkitPrompt implements Presenter {
  private current: OverlayHandle | null = null;

  constructor(private readonly open: OpenOverlay) {}

  show(store: SheetStore, actions: SheetActions): void {
    this.hide();
    const handle = this.open(
      {
        title: "Authentication required",
        ...sheetSize(store.getSnapshot()),
        surface: { layer: "overlay", keyboard: "exclusive", namespace: "dashi.polkit" },
      },
      <PolkitSheet store={store} actions={actions} />,
      () => {
        // The surface went away on its own (its host died): that is a cancel.
        if (this.current !== handle) return;
        this.current = null;
        actions.cancel();
      },
    );
    this.current = handle;
  }

  hide(): void {
    const current = this.current;
    this.current = null;
    current?.close();
  }
}
