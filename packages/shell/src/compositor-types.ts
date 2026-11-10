/**
 * The IPC's types, each inferred from the shape that parses it
 * (src/compositor/: wire.ts, events.ts, outputs.ts, methods/), named here
 * for the shell's readers.
 */

import type { CompositorEvent } from "./compositor/events.ts";
import type { ParamsOf } from "./compositor/methods/spec.ts";
import type { MethodName, Methods } from "./compositor/table.ts";

export type { CompositorEvent, Placing } from "./compositor/events.ts";
export type { Output } from "./compositor/outputs.ts";
export type { CompositorWindow, Frame, Gpu, Point, Session, WindowIcon } from "./compositor/wire.ts";

/** What a method takes. */
export type Params<M extends MethodName> = ParamsOf<Methods[M]>;

/** Where minimize shrinks a window to (`animation-target`; rect null: none). */
export type AnimationTarget = Params<"animation-target">["targets"][number];

export type SuperPhase = Extract<CompositorEvent, { event: "super" }>["phase"];

export type ScreenEdge = Extract<CompositorEvent, { event: "edge-hold" }>["edge"];
