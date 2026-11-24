/**
 * Type at the person's text size (Settings › Appearance › Text size; TY-3):
 * every TYPE role multiplied by one factor, through one reader, so a
 * window's words and the rows that hold them grow together. The launcher's
 * measures and Dashi's own windows read it alike.
 */

import { TYPE, type TypeRole, type TypeSet } from "./measures.ts";
import { DEFAULT_TEXT_SIZE, useTextSize } from "./text-size.ts";

/** A size at text size `factor`, to the half point (the panel row's halves stay halves at 1). */
export function scaleType(px: number, factor: number): number {
  return Math.round(px * factor * 2) / 2;
}

const scaleRole = (role: TypeRole, factor: number): TypeRole => ({ size: scaleType(role.size, factor), line: scaleType(role.line, factor) });

const scaleMap = <K extends string>(roles: Readonly<Record<K, TypeRole>>, factor: number): Record<K, TypeRole> =>
  Object.fromEntries(Object.entries<TypeRole>(roles).map(([name, each]) => [name, scaleRole(each, factor)])) as Record<K, TypeRole>;

const cache = new Map<number, TypeSet>();

/** Every TYPE role at text size `factor` (1 is TYPE itself). */
export function typeAt(factor: number): TypeSet {
  if (factor === DEFAULT_TEXT_SIZE) return TYPE;
  const hit = cache.get(factor);
  if (hit) return hit;
  const { panel, inks, ...app } = TYPE;
  const scaled: TypeSet = { ...scaleMap(app, factor), panel: scaleMap(panel, factor), inks: scaleMap(inks, factor) };
  cache.set(factor, scaled);
  return scaled;
}

/** TYPE at the text size in use; repaints the caller when it changes. */
export function useType(): TypeSet {
  return typeAt(useTextSize());
}
