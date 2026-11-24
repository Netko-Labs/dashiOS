/**
 * Drag-to-tile and the person's drags: the zones sent to the compositor
 * (again whenever the screens or the menu bar and Dock change them), where
 * each dragged window was as its drag began, and what a grab and a drop do.
 * Dragged out of a tile or Fill, a window gets its own size back under the
 * pointer; a drop in a zone tiles it, going back to where the drag began.
 */

import type { Compositor } from "../../compositor/index.ts";
import { dragZones, frameUnderPointer, type Output, type Rect, sameRect, type Tile } from "../../layout.ts";
import type { Arranged, EventOf } from "./arrange-frames.ts";

/** How long the pointer rests in a drag zone before its preview shows. */
export const DWELL_MS = 150;

/** What a drag does to the arranger's windows. */
export interface DragSteps {
  arranged: ReadonlyMap<number, Arranged>;
  /** The window's arrangement is over. */
  forget(id: number): void;
  frame(id: number, frame: Rect): Promise<void>;
  frameOf(id: number): Promise<Rect | null>;
  tileIn(id: number, tile: Tile, usable: Rect, own: Rect): Promise<void>;
}

/** The drag-to-tile zones the screens offer, each with the usable area of its screen. */
export function zonesOf(outputs: readonly Output[]): Array<ReturnType<typeof dragZones>[number] & { usable: Rect }> {
  return outputs.flatMap((output) => dragZones(output).map((zone) => ({ ...zone, usable: output.usable })));
}

/** Drag-to-tile: the zones last sent, and where each dragged window was as its drag began (its own frame, if the drag ends in a tile). */
export class DragTiling {
  /** The zones last sent, in order: which tile each is, on which screen. */
  zones: Array<{ tile: Tile; frame: Rect; usable: Rect }> = [];
  private readonly from = new Map<number, Rect>();

  constructor(private readonly steps: DragSteps) {}

  /** Send the zones of `outputs`; without them (an older compositor), windows still fit their screens. */
  async send(compositor: Pick<Compositor, "layout">, outputs: readonly Output[]): Promise<void> {
    const zones = zonesOf(outputs);
    this.zones = zones.map(({ tile, frame, usable }) => ({ tile, frame, usable }));
    await compositor
      .layout({ zones: zones.map(({ area, frame }) => ({ area, frame })), dwellMs: DWELL_MS })
      .catch((error) => console.error("dashi-shell: drag-to-tile is off:", error instanceof Error ? error.message : error));
  }

  /** The person began to drag or resize a window: the arrangement is over, and dragged out of a tile or Fill it gets its own size back. */
  async grab(event: EventOf<"window-grab">): Promise<void> {
    const arranged = this.steps.arranged.get(event.window);
    this.steps.forget(event.window);
    if (event.kind === "resize") return;
    // At the size it is being asked to take, if its app has not drawn that yet (the compositor says so).
    const frame = this.grabbed(event.window, event.frame, arranged?.own, event.pointer);
    if (frame) await this.steps.frame(event.window, frame);
  }

  /** A drag let go in a drag-to-tile zone: that tile, going back to where the drag began. */
  async drop(event: EventOf<"window-drop">): Promise<void> {
    const drop = this.dropped(event);
    if (!drop) return;
    const frame = await this.steps.frameOf(event.window);
    if (frame) await this.steps.tileIn(event.window, drop.tile, drop.usable, drop.from ?? frame);
  }

  /**
   * A drag began from `from`. Dragged out of a tile or Fill (`own` is the frame
   * it had before), the window gets its own size back under the pointer: that
   * frame, to ask for; otherwise null.
   */
  private grabbed(window: number, from: Rect, own: Rect | undefined, pointer: EventOf<"window-grab">["pointer"]): Rect | null {
    const frame = own ? frameUnderPointer(from, own, pointer) : from;
    this.from.set(window, frame);
    return own ? frame : null;
  }

  forget(window: number): void {
    this.from.delete(window);
  }

  /** A drag let go in a zone: the tile and its screen, and where the drag began; null if the zone is gone (zones sent again since the drag began). */
  private dropped(event: EventOf<"window-drop">): { tile: Tile; usable: Rect; from: Rect | undefined } | null {
    const zone = this.zones[event.zone];
    const from = this.from.get(event.window);
    this.from.delete(event.window);
    if (!zone || !sameRect(zone.frame, event.frame)) return null;
    return { tile: zone.tile, usable: zone.usable, from };
  }
}
