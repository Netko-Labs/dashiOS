/** The shell's chrome, its input claims, and its settings (docs/compositor-ipc.md, "Shell chrome and input claims"). */

import { bool, int, list, literal, map, num, obj, optional, record, str } from "@dashi/shape";
import { FrameShape, PointersShape } from "../../wire.ts";
import { Done, method } from "./spec.ts";

/** One keymap rule (the shell's src/keymap/keymap.ts `Rule`). */
const Rule = obj({
  when: str(),
  app: optional(str()),
  bind: optional(str()),
  send: optional(str()),
  tap: optional(list(str())),
  swallow: optional(bool()),
  armsAfterTap: optional(bool()),
});

const Keymap = obj({
  apps: optional(record(list(str()))),
  tapMs: optional(num()),
  holdMs: optional(num()),
  rules: list(Rule),
  afterTap: optional(list(Rule)),
  locked: optional(list(Rule)),
});

const Layer = obj({ x: optional(num()), y: optional(num()), blur: optional(num()), spread: optional(num()), alpha: optional(num()) });
const Shadow = optional(list(Layer, { max: 2 }));
const Line = obj({ color: optional(str()), width: optional(num()), on: optional(bool()), filled: optional(bool()) });

const WindowStyle = obj({
  shadow: optional(obj({ focused: Shadow, other: Shadow, tiled: Shadow, filled: Shadow, sheet: Shadow })),
  edge: optional(Line),
  ring: optional(Line),
  fade: optional(num({ min: 0, max: 1000 })),
});

const GlassFloor = obj({ ink: str(), ratio: num({ min: 1, max: 21 }) });

/** A material level (`glass-style`; dashi-chrome-v1's `level`). */
const GlassLevel = literal("thin", "regular", "thick", "paper", "veil");

/** A pane of frosted glass behind a shell surface (render/glass/ in dashi-comp): its level, or its own look. */
const GlassPane = obj({
  rect: optional(obj({ x: num(), y: num(), width: num(), height: num() })),
  radius: num({ min: 0, max: 128 }),
  level: optional(GlassLevel),
  blur: optional(num({ min: 0, max: 128 })),
  saturation: optional(num({ min: 0, max: 3 })),
  tint: optional(str()),
  noise: optional(num({ min: 0, max: 1 })),
  xray: optional(bool()),
  brightness: optional(num({ min: 0, max: 3 })),
  floor: optional(GlassFloor),
});

const GlassLevelLook = obj({
  blur: num({ min: 0, max: 128 }),
  saturation: num({ min: 0, max: 3 }),
  tint: str(),
  solid: optional(str()),
  reach: optional(num({ min: 0, max: 512 })),
});

/** How each level looks, and how glass is drawn (`glass-style`). */
const GlassStyle = obj({
  mode: literal("frosted", "xray", "solid"),
  levels: obj({ thin: GlassLevelLook, regular: GlassLevelLook, thick: GlassLevelLook, paper: GlassLevelLook, veil: GlassLevelLook }),
  grain: num({ min: 0, max: 1 }),
  rim: obj({ width: num({ min: 0, max: 4 }), top: str(), middle: str(), bottom: str() }),
  hairline: obj({ width: num({ min: 0, max: 4 }), color: str() }),
  floor: optional(GlassFloor),
  depth: num({ min: 1, max: 8 }),
  apps: GlassLevel,
});

const Pointer = {
  naturalScroll: optional(bool()),
  accelSpeed: optional(num({ min: -1, max: 1 })),
  accelProfile: optional(str()),
  scrollSpeed: optional(num({ min: 0.25, max: 4 })),
};

const Input = obj({
  touchpad: optional(
    obj({
      ...Pointer,
      tap: optional(bool()),
      disableWhileTyping: optional(bool()),
      clickMethod: optional(str()),
      off: optional(bool()),
      offWithMouse: optional(bool()),
    }),
  ),
  mouse: optional(obj(Pointer)),
});

const Keyboard = obj({
  layout: optional(str()),
  variant: optional(str()),
  options: optional(str()),
  repeatRate: optional(num()),
  repeatDelay: optional(num()),
});

export const CHROME = {
  chrome: method("shell", obj({ dark: optional(bool()), radius: optional(num()), reduceMotion: optional(bool()) }), Done),
  "window-style": method("shell", WindowStyle, Done),
  glass: method("shell", obj({ namespace: str(), panes: list(GlassPane, { max: 8 }) }), obj({ frosted: bool() })),
  "glass-style": method("shell", GlassStyle, obj({ frosted: bool() })),
  "glass-clients": method("shell", obj({ others: bool(), deny: list(str()) }), Done),
  keymap: method("shell", Keymap, Done),
  "held-keys": method(
    "shell",
    obj({
      keys: list(
        obj({
          name: str(),
          code: int({ min: 1, max: 767 }),
          bare: optional(bool()),
          alone: optional(bool()),
          super: optional(bool()),
          tapMs: optional(int({ min: 1, max: 2000 })),
        }),
        { max: 16 },
      ),
    }),
    Done,
  ),
  bars: method("shell", obj({ top: optional(num()), show: optional(bool()), output: optional(str()) }), Done),
  edges: method(
    "shell",
    obj({ bottom: num(), output: optional(str()) }),
    map(obj({ inside: bool() }, { strict: false }), ({ inside }) => inside),
  ),
  layout: method(
    "shell",
    obj({
      zones: list(obj({ area: FrameShape, frame: FrameShape })),
      dwellMs: optional(num({ min: 0 })),
      // How the tile's preview is drawn (WI-10): a pane of `level`, `radius` round, `inset` in from its frame.
      preview: optional(obj({ level: GlassLevel, radius: num({ min: 0, max: 64 }), inset: num({ min: 0, max: 64 }) })),
    }),
    Done,
  ),
  gestures: method("shell", obj({ swipe: list(num({ min: 0, max: 10 })) }), Done),
  idle: method("shell", obj({ timeouts: list(num({ min: 0 })) }), Done),
  keyboard: method("shell", Keyboard, Done),
  input: method("shell", Input, Done),
  pointers: method("anyone", obj({}), PointersShape),
};
