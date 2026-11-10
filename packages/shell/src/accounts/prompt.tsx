/**
 * Opens the password sheet: one at a time, centered, holding the keyboard
 * until it is closed (the same kind of surface as the Wi-Fi password sheet).
 */

import { SHEET_SIZE } from "../menus/sheets.tsx";
import type { OpenOverlay, OverlayHandle } from "../overlay.tsx";
import type { PasswordChanger } from "../shared/accounts/types.ts";
import { PasswordChangeSheet } from "./lib/sheet.tsx";

export class PasswordChangePrompt {
  private current: OverlayHandle | null = null;

  constructor(
    private readonly open: OpenOverlay,
    private readonly changer: PasswordChanger,
  ) {}

  ask(needsCurrent: boolean): void {
    this.close();
    const handle = this.open(
      {
        title: "Change Password",
        width: SHEET_SIZE.width + 2 * SHEET_SIZE.margin,
        height: 420,
        surface: { layer: "overlay", keyboard: "exclusive", namespace: "dashi.password" },
      },
      <PasswordChangeSheet changer={this.changer} needsCurrent={needsCurrent} onClose={() => this.close()} />,
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
