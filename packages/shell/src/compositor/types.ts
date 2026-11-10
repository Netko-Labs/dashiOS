/**
 * The IPC's types the shell names that no one shape defines, each inferred
 * from the method table and the events (the shapes' own types are in
 * wire.ts, events.ts and outputs.ts; index.ts names them all).
 */

import type { CompositorEvent } from "./events.ts";
import type { ParamsOf } from "./lib/methods/spec.ts";
import type { MethodName, Methods } from "./table.ts";

/** What a method takes. */
export type Params<M extends MethodName> = ParamsOf<Methods[M]>;

/** Where minimize shrinks a window to (`animation-target`; rect null: none). */
export type AnimationTarget = Params<"animation-target">["targets"][number];

export type SuperPhase = Extract<CompositorEvent, { event: "super" }>["phase"];

export type ScreenEdge = Extract<CompositorEvent, { event: "edge-hold" }>["edge"];
