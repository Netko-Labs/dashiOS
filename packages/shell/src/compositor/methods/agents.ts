/**
 * Capture, agents, secrets for agents, clipboard history and snippets
 * (docs/compositor-ipc.md, "Capture and agents", "Secrets for agents",
 * "Clipboard history and snippets").
 */

import { bool, list, literal, nullable, num, obj, optional, str } from "@dashi/shape";
import { WindowId } from "../wire.ts";
import { Done, method } from "./spec.ts";

const Capture = obj({
  path: str(),
  window: optional(WindowId),
  rect: optional(obj({ x: num(), y: num(), width: num(), height: num() })),
  output: optional(str()),
  cursor: optional(bool()),
  mask: optional(str()),
});

/** The picture saved: its size in pixels and the scale it was taken at. */
const Captured = obj({ width: num(), height: num(), scale: num() }, { strict: false });

const KeyStep = obj({ text: optional(str()), name: optional(str()), state: optional(literal("down", "up")) });

/** An agent's pointer or key action into one window, or `{release: true}` (src/agents/desktop/hands.ts). */
const AgentInput = obj({
  release: optional(bool()),
  window: optional(num({ min: 0 })),
  label: optional(str()),
  pointer: optional(obj({ x: num(), y: num() })),
  action: optional(literal("move", "click", "press", "release", "scroll")),
  button: optional(literal("left", "right", "middle")),
  scroll: optional(obj({ dx: optional(num()), dy: optional(num()) })),
  keys: optional(list(KeyStep)),
  borrow: optional(obj({ idleMs: optional(num({ min: 0 })) })),
});

const Ids = optional(list(num({ min: 0 }), { max: 256 }));

const CaptureMask = obj({
  client: str({ min: 1, max: 64 }),
  windows: Ids,
  rects: optional(list(obj({ window: optional(nullable(WindowId)), x: num(), y: num(), width: num(), height: num() }), { max: 256 })),
  layers: optional(list(str({ max: 128 }), { max: 256 })),
  pids: Ids,
  popups: Ids,
});

/** How long ago (ms) the person's own hands and an agent last pressed there. */
const Origin = obj({ person: nullable(num()), agent: nullable(num()) }, { strict: false });

export const AGENTS = {
  capture: method("shell", Capture, Captured),
  "screencopy-clients": method("shell", obj({ paths: list(str()) }), Done),
  "applet-clients": method("shell", obj({ applets: list(obj({ pid: num({ min: 2 }), layerShell: bool() }), { max: 64 }) }), Done),
  "ipc-clients": method("shell", obj({ clients: list(obj({ pid: num({ min: 2 }), methods: list(str()) }), { max: 64 }) }), Done),
  "agent-input": method("shell", AgentInput, Done),
  "capture-mask": method("shell", CaptureMask, Done),
  "input-origin": method("shell", obj({ namespace: optional(str()), window: optional(num({ min: 0 })) }), Origin),
  snippets: method("shell", obj({ keywords: list(str(), { max: 256 }) }), Done),
  "snippet-erase": method("shell", obj({ window: WindowId, keyword: str() }), Done),
};
