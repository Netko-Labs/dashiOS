/** Session and windows (docs/compositor-ipc.md, "Session and windows"). */

import { bool, lenientList, list, map, nullable, num, obj, optional, str } from "@dashi/shape";
import { FrameShape, SessionShape, WindowId, WindowShape } from "../../wire.ts";
import { Done, method, Nothing } from "./spec.ts";

const OneWindow = obj({ window: WindowId });
const Switch = obj({ window: WindowId, on: bool() });

export const WINDOWS = {
  subscribe: method("shell", Nothing, Done),
  session: method("anyone", Nothing, SessionShape),
  windows: method(
    "granted",
    Nothing,
    map(obj({ windows: lenientList(WindowShape) }, { strict: false }), ({ windows }) => windows),
  ),
  focus: method("granted", OneWindow, Done),
  close: method("granted", OneWindow, Done),
  minimize: method("granted", OneWindow, Done),
  hide: method("granted", OneWindow, Done),
  suspend: method("shell", Switch, Done),
  frame: method(
    "granted",
    obj({ window: WindowId, x: num(), y: num(), width: num(), height: num(), maximized: optional(bool()), tiled: optional(bool()) }),
    Done,
  ),
  place: method("shell", obj({ window: WindowId, x: num(), y: num(), space: optional(num({ min: 0 })) }), Done),
  fullscreen: method("granted", Switch, Done),
  "send-keys": method("shell", obj({ window: WindowId, chord: str() }), Done),
  "animation-target": method("shell", obj({ targets: list(obj({ window: WindowId, rect: optional(nullable(FrameShape)) })) }), Done),
  "layer-motion": method("shell", obj({ namespace: str(), ms: num({ min: 0, max: 300 }), scale: optional(num({ min: 0.5, max: 1 })) }), Done),
  "window-for-handle": method(
    "granted",
    obj({ handle: str() }),
    map(obj({ window: nullable(num()) }, { strict: false }), ({ window }) => window),
  ),
  attach: method("shell", obj({ window: WindowId, parent: optional(nullable(WindowId)), top: optional(num()) }), Done),
};
