/**
 * What the omnibox is given and what it offers: the text being edited, and
 * the folders listed under the field while a path is typed.
 */

import type { Bounds } from "@mirinjs/metal";

/** Folders offered under the field while a path is typed, for the window's overlay to draw. */
export interface Suggestions {
  bounds: Bounds;
  items: readonly string[];
  highlighted: number;
  pick(index: number): void;
}

export interface OmniboxProps {
  /** The text being edited, or null at rest. */
  editing: string | null;
  /** Counts the edits started: each starts a fresh field, never one still holding the last one's text. */
  session?: number;
  onEdit(text: string): void;
  onDone(): void;
  onSuggest(suggestions: Suggestions | null): void;
}
