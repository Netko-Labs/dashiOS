/**
 * Reading PipeWire's objects as `pw-dump` gives them: every field is
 * checked, never cast. A node keeps its properties under `info.props`, a
 * metadata object at the top.
 */

export type Json = Record<string, unknown>;

export const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

export const isId = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export function text(props: Json, key: string): string | null {
  const value = props[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** A pid as PipeWire writes it: a number, or a number in a string (Pulse clients). */
export function pid(props: Json, key: string): number | null {
  const value = props[key];
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return isId(number) && number > 0 ? number : null;
}

export function infoOf(object: Json): Json {
  return isRecord(object.info) ? object.info : {};
}

export function propsOf(object: Json): Json {
  const info = infoOf(object);
  if (isRecord(info.props)) return info.props;
  return isRecord(object.props) ? object.props : {};
}

/** object.serial: a number, or a number in text. */
export function serialOf(props: Json): number | null {
  const value = props["object.serial"];
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return isId(number) ? number : null;
}
