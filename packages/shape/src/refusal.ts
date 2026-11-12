/**
 * What every parser answers when it says no: a refusal that names the field
 * and the rule, so a person (or the peer that sent it) can act on it.
 */

/** A message, or part of one, that was refused, and why. */
export type Refusal = { error: string };

export const refuse = (error: string): Refusal => ({ error });

/** A refusal from the field-by-field kit (`record`, `text`, `list`, …). Shapes answer `Parsed` instead. */
export const isRefusal = (value: unknown): value is Refusal => typeof value === "object" && value !== null && "error" in value;

/** A plain object: not null, not an array. The one `isRecord` (H7). */
export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A shape's answer: the value, or why not. Unlike `T | Refusal`, a value with its own `error` field is never mistaken for a refusal. */
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export const accept = <T>(value: T): Parsed<T> => ({ ok: true, value });

export const reject = <T = never>(error: string): Parsed<T> => ({ ok: false, error });

/** Thrown by `must`: outside data that did not have the shape asked for. */
export class ShapeError extends Error {
  override readonly name = "ShapeError";
}
