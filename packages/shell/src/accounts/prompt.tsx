/**
 * Opens the password sheet: one at a time, holding the keyboard until it is
 * closed (the same kind of surface as the Wi-Fi password sheet). It is a sheet
 * of Settings' (SE-15, UI-5), so it hangs from Settings' window over the scrim:
 * its surface lies over the window exactly. When the shell can't say where
 * Settings is (no compositor, the window gone), it is centred on the screen.
 */

import type { Compositor } from "../compositor/index.ts";
import { sheetSurfaceWidth } from "../menus/sheets.tsx";
import type { OpenOverlay, OverlayHandle } from "../overlay.tsx";
import type { PasswordChanger } from "../shared/accounts/index.ts";
import { PasswordChangeSheet } from "./lib/sheet.tsx";

/** The surface on the screen when Settings can't be found: the card and its shadow's room. */
const ON_SCREEN = { height: 420 } as const;

/** Where a window is, as a layer surface over it is placed: its screen, and its frame from that screen's top left. */
export interface WindowPlace {
  output?: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A surface's place over a window with this outer frame, on the screen that holds most of it (null: none). */
export function placeOver(frame: Frame | null, screens: ReadonlyArray<{ name: string; frame: Frame | null }>): WindowPlace | null {
  if (!frame || frame.width <= 0 || frame.height <= 0) return null;
  const cx = frame.x + frame.width / 2;
  const cy = frame.y + frame.height / 2;
  const screen = screens.find(({ frame: s }) => s !== null && cx >= s.x && cx < s.x + s.width && cy >= s.y && cy < s.y + s.height);
  if (!screen?.frame) return null;
  return { output: screen.name, left: frame.x - screen.frame.x, top: frame.y - screen.frame.y, width: frame.width, height: frame.height };
}

/** Where the window with this app id is now (Settings'), from the compositor; null without one. */
export function windowPlaceOf(compositor: Compositor | null, appId: string): () => Promise<WindowPlace | null> {
  return async () => {
    if (!compositor) return null;
    const [windows, screens] = await Promise.all([compositor.windows(), compositor.outputs()]);
    return placeOver(windows.find((window) => window.appId === appId)?.frame ?? null, screens);
  };
}

export class PasswordChangePrompt {
  private current: OverlayHandle | null = null;
  /** Counts the asks: only the latest one opens, once Settings' place is known. */
  private asks = 0;

  constructor(
    private readonly open: OpenOverlay,
    private readonly changer: PasswordChanger,
    /** Where Settings' window is; null when it can't be said. */
    private readonly settings: () => Promise<WindowPlace | null> = async () => null,
  ) {}

  ask(needsCurrent: boolean): void {
    this.close();
    const serial = ++this.asks;
    void this.settings()
      .catch(() => null)
      .then((place) => {
        if (serial === this.asks) this.show(needsCurrent, place);
      });
  }

  private show(needsCurrent: boolean, place: WindowPlace | null): void {
    const namespace = "dashi.password";
    const options = place
      ? {
          title: "Change password",
          width: place.width,
          height: place.height,
          surface: {
            layer: "overlay" as const,
            anchor: ["top" as const, "left" as const],
            // Placed from the screen's corner, not pushed by the menu bar's zone: exactly over the window.
            exclusiveZone: -1,
            margin: { top: place.top, left: place.left },
            keyboard: "exclusive" as const,
            namespace,
            ...(place.output === undefined ? {} : { output: place.output }),
          },
        }
      : {
          title: "Change password",
          width: sheetSurfaceWidth(),
          height: ON_SCREEN.height,
          surface: { layer: "overlay" as const, keyboard: "exclusive" as const, namespace },
        };
    const handle = this.open(
      options,
      <PasswordChangeSheet changer={this.changer} needsCurrent={needsCurrent} place={place ? "window" : "screen"} onClose={() => this.close()} />,
      () => {
        if (this.current === handle) this.current = null;
      },
    );
    this.current = handle;
  }

  close(): void {
    this.asks++;
    const current = this.current;
    this.current = null;
    current?.close();
  }
}
