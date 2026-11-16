/**
 * The bar's one indicator (decisions.md D138, D261), as a slot of the menu
 * bar's status side (menubar-program-slots.tsx): nothing of Dashi's agent
 * at rest. It shows only while something acts on the computer that the
 * person is not already watching: an agent connected from outside, a run,
 * or Dashi's own agent kept working on its own. It is a safety rule, not
 * decoration: the person can always see, and stop, what acts. A click opens
 * the agents' panel, where each one has its row and Stop.
 */

import { useSyncExternalStore } from "react";
import { AgentMark } from "../../agent-mark.tsx";
import { DEFAULT_PERSONA, markSvg } from "../../shared/pill/index.ts";
import type { BarPill } from "../pill.ts";
import type { ProgramContext } from "./menubar-program-slots.tsx";
import type { StatusSlot } from "./menubar-status.tsx";

const NEVER = () => () => {};

export interface PillNow {
  colour: string;
  /** The persona's mark, as SVG. */
  glyph: string;
  name: string;
}

/** The persona's colour, mark and name, read live; null without a pill. */
export function usePill(pill: BarPill | undefined, agent: string): PillNow | null {
  const persona = useSyncExternalStore(pill?.hub.persona.subscribe ?? NEVER, pill ? pill.hub.persona.getSnapshot : () => DEFAULT_PERSONA);
  if (!pill) return null;
  // The default purple follows the appearance (lighter in Dark); a colour the person chose is theirs.
  const colour = persona.colour.toLowerCase() === DEFAULT_PERSONA.colour.toLowerCase() ? agent : persona.colour;
  return { colour, glyph: markSvg(persona.mark), name: persona.name };
}

/** The one indicator, or nothing when nothing acts. */
export function agentMarkSlot({ sources, mark, outside, pill, tip, appName }: ProgramContext, accessible: boolean): StatusSlot[] {
  if (mark.kind === "none") return [];
  const { output, menus } = sources;
  const need = outside.waiting;
  const name = pill?.name ?? "Dashi";
  const label = need > 0 ? `${name}: ${need} ${need === 1 ? "agent needs" : "agents need"} you` : mark.label;
  const panel = (right: number) => void menus.toggleAgents(appName, right, null, output);
  return [
    {
      key: "agent-mark",
      goes: null,
      label,
      radius: 11,
      open: { kind: "panel" as const, run: (bounds) => panel(bounds ? bounds.x + bounds.width : 0) },
      node: (
        <AgentMark
          need={need}
          watching={mark.watching}
          open={false}
          working={mark.kind === "mark" && mark.working}
          {...(pill ? { colour: pill.colour, glyph: pill.glyph } : {})}
          label={label}
          tip={mark.tip}
          agents={outside}
          onAgents={panel}
          onPress={panel}
          onTip={tip}
          accessible={accessible}
        />
      ),
    },
  ];
}
