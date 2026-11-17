/** The widgets' data: what a placed widget is, its size, and where it goes. */

import type { InkName } from "@dashi/ui";
import type { GlyphName } from "../shared/inks/index.ts";

/** Sizes in words (round five, #26), on a grid of 80-point cells 12 apart in the area's 356 column. */
export type WidgetSize = "mini" | "compact" | "small" | "strip" | "wide" | "tall" | "large";

/** Dashi's own widgets, and an outside extension's by its id ("ext:<extension>/<widget>"). */
export type WidgetKind =
  | "rundown"
  | "clock"
  | "world"
  | "calendar"
  | "weather"
  | "battery"
  | "system"
  | "media"
  | "timer"
  | "notes"
  | "agents"
  | `ext:${string}`;

/** One placed widget (an instance): what, how big, and its own settings. */
export interface Placement {
  /** Stable for the instance's life ("w3"). */
  id: string;
  kind: WidgetKind;
  size: WidgetSize;
  /** Weather may go on air when rain is near: off by default (round five, frame 3). */
  mayGoOnAir?: boolean;
  /** Private details stay hidden on the lock screen unless the person allowed them for this one. */
  showPrivateWhenLocked?: boolean;
}

/** What the gallery and the edit tag say about a kind. */
export interface WidgetInfo {
  kind: WidgetKind;
  name: string;
  /** Its category's ink; null prints in plain ink (Clock, Notes, System, every extension). */
  ink: InkName | null;
  glyph: GlyphName;
  /** The sizes it offers; the first is the one it is added in. */
  sizes: readonly WidgetSize[];
  /** Whether it holds anything private (events, notes, agents' work). */
  holdsPrivate: boolean;
  /** One line for the gallery. */
  blurb: string;
}

/** A placed widget's box in the column, in points. */
export interface Placed {
  placement: Placement;
  x: number;
  y: number;
  width: number;
  height: number;
}
