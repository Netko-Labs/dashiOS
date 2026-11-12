import { isRecord } from "@dashi/shape";
import type { SpacesState } from "./types.ts";
/**
 * Spaces as plain data: what the compositor says about them, and what the keys
 * mean. Pure, so every rule is tested without a compositor. Spaces are numbered from 0 here and
 * over IPC (comp/src/spaces/); people see "Desktop 1" and up.
 */

/** The compositor's limit (comp/src/spaces/model.rs). */
export const MAX_SPACES = 16;

export const ONE_SPACE: SpacesState = { count: 1, current: 0 };

const isIndex = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** The `spaces` answer (or a `space` event), checked; null when it makes no sense. */
export function parseSpaces(value: unknown): SpacesState | null {
  if (!isRecord(value)) return null;
  const { count, current } = value;
  if (!isIndex(count) || !isIndex(current) || count < 1 || count > MAX_SPACES || current >= count) return null;
  return { count, current };
}

/** What people call Space `index`. */
export const spaceLabel = (index: number): string => `Desktop ${index + 1}`;

/** The keymap's names for the Spaces keys (keymap.ts): ⌃← ⌃→ and ⌃1…⌃9. */
export type SpaceBinding = { kind: "left" } | { kind: "right" } | { kind: "jump"; index: number };

export function parseSpaceBinding(name: string): SpaceBinding | null {
  if (name === "space-left") return { kind: "left" };
  if (name === "space-right") return { kind: "right" };
  const jump = /^space-([1-9])$/.exec(name);
  return jump ? { kind: "jump", index: Number(jump[1]) - 1 } : null;
}

/** The Space a binding goes to, or null when there is none that way (no wrapping, as on a Mac). */
export function bindingTarget(binding: SpaceBinding, state: SpacesState): number | null {
  const target = binding.kind === "left" ? state.current - 1 : binding.kind === "right" ? state.current + 1 : binding.index;
  return target >= 0 && target < state.count && target !== state.current ? target : null;
}
