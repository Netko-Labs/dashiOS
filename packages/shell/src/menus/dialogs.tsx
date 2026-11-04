/**
 * The sheets the menus open, one at a time: asking before a restart, shut
 * down, or log out, and About. Each is a centered overlay that holds the
 * keyboard (so Esc answers it) until it is answered.
 */

import type { ReactElement } from "react";
import type { OpenOverlay, OverlayHandle } from "../overlay.tsx";
import type { PowerKind } from "./model.ts";
import { type AboutInfo, AboutWindow, ConfirmSheet, SHEET_SIZE } from "./sheets.tsx";

const WIDTH = SHEET_SIZE.width + 2 * SHEET_SIZE.margin;

export class Dialogs {
  private current: OverlayHandle | null = null;

  constructor(
    private readonly open: OpenOverlay,
    /** Carries out a power action once the person said yes. */
    private readonly power: (what: PowerKind) => void,
  ) {}

  confirm(what: PowerKind): void {
    const answer = (yes: boolean) => {
      this.close();
      if (yes) this.power(what);
    };
    this.show("Confirm", 290, <ConfirmSheet what={what} onConfirm={() => answer(true)} onCancel={() => answer(false)} />);
  }

  about(info: AboutInfo): void {
    this.show("About", 310, <AboutWindow info={info} onClose={() => this.close()} />);
  }

  close(): void {
    const current = this.current;
    this.current = null;
    current?.close();
  }

  private show(title: string, height: number, element: ReactElement): void {
    this.close();
    const handle = this.open({ title, width: WIDTH, height, surface: { layer: "overlay", keyboard: "exclusive", namespace: "dashi.dialog" } }, element, () => {
      if (this.current === handle) this.current = null;
    });
    this.current = handle;
  }
}
