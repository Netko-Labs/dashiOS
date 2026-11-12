/**
 * A method's spec: who may ask it, its params' shape and its reply's. The
 * params are checked before they are sent (a mistake is the shell's, and
 * named), the reply as it comes (H7).
 */

import { type Infer, obj, type Shape } from "@dashi/shape";

export type Who = "shell" | "granted" | "anyone";

export interface Spec<P, R> {
  who: Who;
  params: Shape<P>;
  reply: Shape<R>;
}

export const method = <P, R>(who: Who, params: Shape<P>, reply: Shape<R>): Spec<P, R> => ({ who, params, reply });

/** No params: `{}`. */
export const Nothing = obj({});

/** The reply of a request that only says it is done: `{}` (anything more is ignored). */
export const Done = obj({}, { strict: false });

export type ParamsOf<S> = S extends Spec<infer P, unknown> ? P : never;
export type ReplyOf<S> = S extends Spec<unknown, infer R> ? R : never;
export type InferParams<S extends Shape<unknown>> = Infer<S>;
