/**
 * Which graphics mode to be in (docs/0.4.0.html, Graphics D). Automatic, the
 * default: Integrated on battery, so the card sleeps; Hybrid plugged in, or
 * when a screen is connected to the card's own ports (it can only be driven
 * by the card). Apps already on the card are never pulled off: going to
 * Integrated waits until they quit, and Dashi says once that it is waiting.
 * A manual pick (Integrated, Smart, Hybrid) is applied as asked. A lost card
 * (lost-card.ts) stops all switching until the next restart.
 */

import type { GraphicsChoice } from "../power/modes/settings.ts";

export type GraphicsMode = "integrated" | "hybrid" | "smart";
export const GRAPHICS_MODES: readonly GraphicsMode[] = ["integrated", "smart", "hybrid"];
export const GRAPHICS_LABEL: Readonly<Record<GraphicsMode, string>> = { integrated: "Integrated", smart: "Smart", hybrid: "Hybrid" };

export interface GraphicsInputs {
  choice: GraphicsChoice;
  plugged: boolean;
  /** Screens connected to the card's own ports. */
  cardScreens: readonly string[];
  /** The apps holding the card now, by name. */
  holders: readonly string[];
  /** The mode cardwire is in; "manual" is cardwire's own and counts as none of Dashi's. */
  current: GraphicsMode | "manual" | null;
  lost: boolean;
}

export interface GraphicsDecision {
  /** The mode to set now, or null to leave it. */
  set: GraphicsMode | null;
  /** The mode wanted (shown as "Automatic: Integrated"). */
  wanted: GraphicsMode | null;
  /** The apps it is waiting for before going to Integrated; empty when not waiting. */
  waitingFor: readonly string[];
  /** One line: why this mode. */
  why: string;
}

export function decideGraphics(inputs: GraphicsInputs): GraphicsDecision {
  if (inputs.lost) return { set: null, wanted: null, waitingFor: [], why: "The graphics card isn't responding. Switching waits for a restart." };
  if (inputs.choice !== "automatic") {
    return {
      set: inputs.current === inputs.choice ? null : inputs.choice,
      wanted: inputs.choice,
      waitingFor: [],
      why: `${GRAPHICS_LABEL[inputs.choice]}, chosen by you`,
    };
  }
  const screen = inputs.cardScreens[0];
  const wanted: GraphicsMode = inputs.plugged || screen !== undefined ? "hybrid" : "integrated";
  const why = screen !== undefined ? `a screen is connected to the graphics card (${screen})` : inputs.plugged ? "plugged in" : "on battery";
  if (wanted === inputs.current) return { set: null, wanted, waitingFor: [], why: `Automatic chose ${GRAPHICS_LABEL[wanted]}: ${why}` };
  if (wanted === "integrated" && inputs.holders.length > 0) {
    return {
      set: null,
      wanted,
      waitingFor: inputs.holders,
      why: `Switches to the built-in graphics when ${listNames(inputs.holders)} ${inputs.holders.length === 1 ? "quits" : "quit"}`,
    };
  }
  return { set: wanted, wanted, waitingFor: [], why: `Automatic chose ${GRAPHICS_LABEL[wanted]}: ${why}` };
}

/** "Steam", "Steam and Helium", "Steam, Helium and Blender". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
