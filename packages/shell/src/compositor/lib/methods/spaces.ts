/** Spaces, the overview, and live pictures (docs/compositor-ipc.md, "Spaces and overview", "Live pictures"). */

import { bool, int, list, num, obj, optional, str } from "@dashi/shape";
import { FrameShape, WindowId } from "../../wire.ts";
import { Done, method } from "./spec.ts";

/** A Space's index, from 0. */
const Space = int({ min: 0, max: 15 });

/** How many Spaces there are and which shows; `space-add` also says the new one's index. */
const Spaces = obj({ count: num(), current: num(), space: optional(num()) }, { strict: false });

/** A picture's rect: global logical, a positive size. */
const Picture = { x: num(), y: num(), w: num(), h: num() };

export const SPACES = {
  spaces: method("shell", obj({ count: optional(int({ min: 1, max: 16 })), follow: optional(bool()), quiet: optional(list(Space)) }), Spaces),
  "space-add": method("shell", obj({ at: optional(int({ min: 0 })) }), Spaces),
  "space-remove": method("shell", obj({ space: Space }), Spaces),
  "space-switch": method("granted", obj({ space: Space, progress: optional(num()), carry: optional(WindowId) }), Spaces),
  "space-move": method("granted", obj({ window: WindowId, space: Space }), Done),
  overview: method("shell", obj({ windows: optional(list(obj({ id: num({ min: 0 }), rect: FrameShape }))), duration: optional(num({ min: 0 })) }), Done),
  "space-previews": method("shell", obj({ output: str(), rects: list(obj({ space: Space, ...Picture, screen: optional(str()) }), { max: 64 }) }), Done),
  "window-thumbnails": method("shell", obj({ rects: list(obj({ window: num({ min: 0 }), ...Picture }), { max: 64 }) }), Done),
};
