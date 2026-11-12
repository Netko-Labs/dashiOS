/** Spaces' public types: the state the compositor reports, the names people give, a swipe's step. */

export interface SpacesState {
  count: number;
  /** The Space that shows, from 0. */
  current: number;
}

export type SpaceNames = (string | null)[];

export type SwipeStep =
  | { kind: "none" }
  /** Mission Control opens (up) or closes (down). */
  | { kind: "overview"; open: boolean }
  /** Hold the switch to `target` this far along. */
  | { kind: "space-hold"; target: number; progress: number }
  /** Let the switch to `target` finish. */
  | { kind: "space-finish"; target: number }
  /** Go back to `origin` from wherever the switch got to. */
  | { kind: "space-back"; origin: number };
