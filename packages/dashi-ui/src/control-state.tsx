/**
 * The states a control draws (docs/design.html, UI-4): hover (Metal's own
 * `hoverBackgroundColor`), pressed, focused, and disabled. Metal has no
 * pressed state of its own, so a control learns it from `onPointer`: down
 * presses it, up (anywhere: Metal keeps the pointer until the button lifts)
 * lets go. Disabled is the whole control at 40%, so a disabled primary
 * button still reads as primary.
 *
 * Focused is a hook for the focus model (KB-2): a control takes `focused`
 * and sets `data-focused` on its view, and draws no ring yet. The gallery
 * shows a control pressed or focused without touching it (`ShowStates`).
 */

import type { PointerInfo } from "@mirinjs/metal";
import { createContext, createElement, type ReactNode, useContext, useState } from "react";

/** A disabled control is drawn whole at this opacity (UI-4). */
export const DISABLED_OPACITY = 0.4;

export interface ShownStates {
  pressed?: boolean;
  focused?: boolean;
}

const Shown = createContext<ShownStates>({});

/** Every control under it draws as pressed or focused: the Components gallery's state rows. */
export function ShowStates({ pressed, focused, children }: ShownStates & { children?: ReactNode }): ReactNode {
  return createElement(Shown.Provider, { value: { pressed, focused } }, children);
}

export interface ControlState {
  pressed: boolean;
  focused: boolean;
  /** For the control's view: the press, while it lasts. Absent when the control is disabled. */
  onPointer?: (event: PointerInfo) => void;
  /** For the control's view: the whole control dimmed when it is disabled. */
  opacity?: number;
}

/** Whether a pointer phase holds the control down. */
export function isHeld(phase: PointerInfo["phase"]): boolean {
  return phase !== "up";
}

/** A control's pressed and focused state, and what its view needs to follow the press. */
export function useControlState({ disabled, focused }: { disabled?: boolean; focused?: boolean } = {}): ControlState {
  const shown = useContext(Shown);
  const [held, setHeld] = useState(false);
  const isDisabled = disabled === true;
  return {
    pressed: !isDisabled && (held || shown.pressed === true),
    focused: focused === true || shown.focused === true,
    ...(isDisabled
      ? { opacity: DISABLED_OPACITY }
      : {
          onPointer: (event: PointerInfo) => {
            const next = isHeld(event.phase);
            setHeld((now) => (now === next ? now : next));
          },
        }),
  };
}
