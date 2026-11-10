/**
 * Puts the pairing sheet on screen while BlueZ is asking something, and
 * takes it down when the question is gone (answered, withdrawn, or the
 * pairing ended). The sheet holds the keyboard, so the Control Center popover
 * that may be open closes first: it would only sit in the way.
 */

import { SHEET_SIZE } from "../menus/sheets.tsx";
import type { OpenOverlay, OverlayHandle } from "../overlay.tsx";
import { PairingSheet } from "./lib/sheet.tsx";
import type { BluetoothStore } from "./store.ts";

export class PairingPrompt {
  private current: OverlayHandle | null = null;
  private stop: (() => void) | null = null;

  constructor(
    private readonly open: OpenOverlay,
    private readonly bluetooth: BluetoothStore,
    /** Runs just before the sheet opens. */
    private readonly beforeOpen: () => void,
  ) {}

  /** Follows the store until `close`. */
  start(): void {
    this.stop ??= this.bluetooth.subscribe(() => this.sync());
    this.sync();
  }

  private sync(): void {
    const asking = this.bluetooth.getSnapshot().prompt !== null;
    if (asking && !this.current) this.show();
    else if (!asking && this.current) this.hide();
  }

  private show(): void {
    this.beforeOpen();
    const handle: OverlayHandle = this.open(
      {
        title: "Bluetooth pairing",
        width: SHEET_SIZE.width + 2 * SHEET_SIZE.margin,
        height: 330,
        surface: { layer: "overlay", keyboard: "exclusive", namespace: "dashi.bluetooth-pairing" },
      },
      <PairingSheet bluetooth={this.bluetooth} />,
      () => {
        // The host went by itself: the question is unanswered, so the answer is no.
        if (this.current !== handle) return;
        this.current = null;
        this.bluetooth.decline();
      },
    );
    this.current = handle;
  }

  private hide(): void {
    const current = this.current;
    this.current = null;
    current?.close();
  }

  /** The screen locked: the question goes unanswered, which is a no, and the sheet comes down. */
  dismiss(): void {
    if (!this.current) return;
    this.bluetooth.decline();
    this.hide();
  }

  close(): void {
    this.stop?.();
    this.stop = null;
    this.hide();
  }
}
