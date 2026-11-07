/**
 * The sheets the menus open, one at a time: asking before a restart, shut
 * down, or log out, and About. Each is a centered overlay that holds the
 * keyboard (so Esc answers it) until it is answered. Once a restart, shut
 * down, or log out is confirmed, the apps are asked to close first
 * (closing-apps.ts); while one holds its window to ask, a notice at the foot
 * of the screen (or under the menu bar, if the window is that low) names it,
 * never over the app's own question, and leaves the keyboard to it.
 */

import type { NativeHostOptions } from "@mirinjs/metal";
import type { ReactElement } from "react";
import { type AppWindow, ClosingChoice, closeApps } from "../closing-apps.ts";
import type { OpenOverlay, OverlayHandle } from "../overlay.tsx";
import { HOLDING_SURFACE, type HoldingPlace } from "./holding-place.ts";
import type { PowerKind } from "./model.ts";
import { type AboutInfo, AboutWindow, ConfirmSheet, HoldingNotice, SHEET_SIZE } from "./sheets.tsx";

/** What closing the apps first needs: their windows, and the compositor's close and focus. */
export interface DialogApps {
  windows(): Promise<AppWindow[]>;
  close(window: number): Promise<void>;
  focus(window: number): void;
  /** Where the notice naming the app goes for this window: clear of its sheet (holding-place.ts); at the foot without it. */
  place?(window: number): Promise<HoldingPlace>;
}

const WIDTH = SHEET_SIZE.width + 2 * SHEET_SIZE.margin;

export class Dialogs {
  private current: OverlayHandle | null = null;

  /** The wait for the apps of a confirmed power action, while there is one. */
  private ending: ClosingChoice | null = null;

  /** Counts the notices asked for: only the latest one asked opens. */
  private holdings = 0;

  constructor(
    private readonly open: OpenOverlay,
    /** Carries out a power action once the person said yes (and the apps closed). */
    private readonly power: (what: PowerKind) => void,
    /** The apps to close first; without them the action goes at once. */
    private readonly apps?: DialogApps,
  ) {}

  confirm(what: PowerKind): void {
    const answer = (yes: boolean) => {
      this.close();
      if (yes) void this.end(what);
    };
    this.show("Confirm", 290, <ConfirmSheet what={what} onConfirm={() => answer(true)} onCancel={() => answer(false)} />);
  }

  /** Asks the apps to close, then carries `what` out unless the person cancelled while one held it. */
  private async end(what: PowerKind): Promise<void> {
    const apps = this.apps;
    if (!apps) return this.power(what);
    // A second confirmed action replaces a wait still going.
    if (this.ending) this.ending.answer = "cancel";
    const choice = new ClosingChoice();
    this.ending = choice;
    const outcome = await closeApps(
      {
        windows: () => apps.windows(),
        close: (window) => apps.close(window),
        holding: (names, first) => {
          apps.focus(first);
          void this.showHolding(what, names, first, choice);
        },
        done: () => {
          // A notice still finding its place doesn't open after the wait.
          this.holdings++;
          if (this.ending === choice) this.close();
        },
      },
      choice,
    );
    if (this.ending === choice) this.ending = null;
    if (outcome !== "cancel") this.power(what);
  }

  private async showHolding(what: PowerKind, names: readonly string[], first: number, choice: ClosingChoice): Promise<void> {
    const answer = (value: "cancel" | "anyway") => {
      choice.answer ??= value;
    };
    const serial = ++this.holdings;
    // Clear of the app's own sheet, which hangs from its window's top (holding-place.ts).
    const place = (await this.apps?.place?.(first).catch(() => null)) ?? { edge: "bottom" as const };
    // The wait may have ended, or another app be holding it now, while the compositor answered.
    if (serial !== this.holdings || this.ending !== choice || choice.answer) return;
    this.close();
    const surface = {
      layer: "overlay",
      anchor: [place.edge],
      keyboard: "on-demand",
      namespace: "dashi.dialog",
      ...(place.output === undefined ? {} : { output: place.output }),
    } satisfies NativeHostOptions["surface"];
    const handle = this.open(
      { title: "Waiting", width: HOLDING_SURFACE.width, height: HOLDING_SURFACE.height, surface },
      <HoldingNotice what={what} names={names} edge={place.edge} onCancel={() => answer("cancel")} onAnyway={() => answer("anyway")} />,
      () => {
        if (this.current !== handle) return;
        this.current = null;
        // Taken down by something else (the overview, the lock screen): the session stays.
        answer("cancel");
      },
    );
    this.current = handle;
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
