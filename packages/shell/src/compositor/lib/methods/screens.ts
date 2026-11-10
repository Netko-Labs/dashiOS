/** Screens, GPUs, and the wallpaper (docs/compositor-ipc.md, "Screens"). */

import { bool, lenientList, list, literal, map, nullable, num, obj, optional, str } from "@dashi/shape";
import { OutputsShape } from "../../outputs.ts";
import { GpuShape } from "../../wire.ts";
import { Done, method, Nothing } from "./spec.ts";

const Mode = literal("fill", "fit", "center");

/** What the desktop shows behind the windows (the shell's src/wallpaper/catalog.ts `WallpaperRequest`), or `{paused}`. */
const Wallpaper = obj({
  paused: optional(bool()),
  mode: optional(Mode),
  gradient: optional(bool()),
  shader: optional(str()),
  fps: optional(num()),
  path: optional(str()),
  video: optional(str()),
});

const OutputConfig = obj({
  name: str(),
  enabled: optional(bool()),
  position: optional(obj({ x: num(), y: num() })),
  mode: optional(obj({ width: num(), height: num(), refreshMhz: num() })),
  transform: optional(obj({ rotation: optional(num()), flipped: optional(bool()) })),
  scale: optional(num({ min: 0.5, max: 4 })),
  vrr: optional(literal("off", "on", "fullscreen")),
});

export const SCREENS = {
  outputs: method("anyone", Nothing, OutputsShape),
  mirror: method("shell", obj({ output: str(), source: optional(nullable(str())) }), Done),
  output: method("granted", obj({ name: str(), scale: num() }), Done),
  "xwayland-scale": method("shell", obj({ scale: num() }), Done),
  "cursor-size": method("shell", obj({ size: num({ min: 16, max: 128 }) }), Done),
  "input-region": method(
    "shell",
    obj({ namespace: str(), rects: optional(nullable(list(obj({ x: num(), y: num(), width: num(), height: num() }), { max: 32 }))) }),
    Done,
  ),
  "outputs-config": method("granted", obj({ outputs: list(OutputConfig), primary: optional(str()) }), Done),
  power: method("shell", obj({ on: bool(), reset: optional(bool()), output: optional(str()) }), Done),
  gamma: method("shell", obj({ red: num(), green: num(), blue: num() }), Done),
  gpus: method(
    "anyone",
    Nothing,
    map(obj({ gpus: lenientList(GpuShape) }, { strict: false }), ({ gpus }) => gpus),
  ),
  "gpu-keep": method("shell", obj({ card: str(), on: bool() }), Done),
  wallpaper: method("shell", Wallpaper, Done),
};
