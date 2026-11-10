/**
 * Asking for a password: one sheet at a time, centered, holding the keyboard
 * until it is answered (the same kind of surface as the power sheets).
 */

import { SHEET_SIZE } from "../menus/sheets.tsx";
import type { OpenOverlay, OverlayHandle } from "../overlay.tsx";
import { PasswordSheet } from "./lib/password.tsx";
import type { WifiStore } from "./store.ts";
import type { WifiNetwork } from "./types.ts";

export class PasswordPrompt {
  private current: OverlayHandle | null = null;

  constructor(
    private readonly open: OpenOverlay,
    private readonly wifi: WifiStore,
  ) {}

  ask(network: WifiNetwork): void {
    this.close();
    const handle = this.open(
      {
        title: "Wi-Fi password",
        width: SHEET_SIZE.width + 2 * SHEET_SIZE.margin,
        height: 330,
        surface: { layer: "overlay", keyboard: "exclusive", namespace: "dashi.wifi-password" },
      },
      <PasswordSheet network={network} wifi={this.wifi} onClose={() => this.close()} />,
      () => {
        if (this.current === handle) this.current = null;
      },
    );
    this.current = handle;
  }

  close(): void {
    const current = this.current;
    this.current = null;
    current?.close();
  }
}
