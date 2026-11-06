/**
 * Text size (Settings › Appearance › Text size; settings.json
 * `appearance.textSize`): a factor the shell's surfaces multiply their type
 * by, rows growing with it. The host says where it comes from
 * (`setTextSizeSource`), as it does for Dark Mode; unconnected, it is 1.
 */

import { useSyncExternalStore } from "react";

/** The sizes offered: Default, Large, Larger, Largest. */
export const TEXT_SIZES = [1, 1.15, 1.3, 1.5] as const;
export const DEFAULT_TEXT_SIZE = 1;

export const isTextSize = (value: unknown): value is number => typeof value === "number" && (TEXT_SIZES as readonly number[]).includes(value);

export interface TextSizeSource {
  subscribe(listener: () => void): () => void;
  textSize(): number;
}

const STANDARD: TextSizeSource = { subscribe: () => () => {}, textSize: () => DEFAULT_TEXT_SIZE };

let source: TextSizeSource = STANDARD;

/** Connect where the text size comes from; call it before the first render. */
export function setTextSizeSource(next: TextSizeSource): void {
  source = next;
}

/** The text size now (1 is the standard); repaints the caller when it changes. */
export function useTextSize(): number {
  return useSyncExternalStore(source.subscribe, source.textSize);
}

/** A measure at text size `size`, in whole pixels (type and the rows that hold it). */
export function scaled(px: number, size: number): number {
  return Math.round(px * size);
}
