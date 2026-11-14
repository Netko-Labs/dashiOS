/**
 * Dashi's mark and the jobs beside it, as slots of the menu bar's status
 * side (menubar-program-slots.tsx): the jobs' capsules, shrinking to discs
 * and a count in the room they are given, then the mark, which a click
 * turns into the field. What they draw from is read live (`usePill`).
 */

import { type Bounds, View } from "@mirinjs/metal";
import { useSyncExternalStore } from "react";
import { AgentMark } from "../../agent-mark.tsx";
import { DEFAULT_PERSONA, markSvg, type PillAsk } from "../../shared/pill/index.ts";
import type { FieldState } from "../field.ts";
import { type BarPill, taskFocus } from "../pill.ts";
import { type BarJob, jobLabel, layoutJobs, needCount } from "./bar-jobs.ts";
import { JobsRow } from "./job-capsule.tsx";
import type { ProgramContext } from "./menubar-program-slots.tsx";
import type { StatusSlot } from "./menubar-status.tsx";

const NEVER = () => () => {};

export interface PillNow {
  source: BarPill;
  jobs: readonly BarJob[];
  speaking: string | null;
  asks: readonly PillAsk[];
  colour: string;
  /** The persona's mark, as SVG. */
  glyph: string;
  name: string;
  fieldOpen: boolean;
}

const NO_JOBS = { subscribe: NEVER, getSnapshot: () => NO_JOBS_SNAPSHOT } as const;
const NO_JOBS_SNAPSHOT = { jobs: [], speaking: null } as const;
const NO_ASKS: readonly PillAsk[] = [];
const NO_FIELD: Pick<FieldState, "open" | "output"> = { open: false, output: undefined };

/** What the mark and the jobs draw from, read live; null without a pill. */
export function usePill(pill: BarPill | undefined, output: string | undefined, agent: string): PillNow | null {
  const { jobs, speaking } = useSyncExternalStore(pill?.jobs.subscribe ?? NEVER, pill ? pill.jobs.getSnapshot : NO_JOBS.getSnapshot);
  const asks = useSyncExternalStore(pill?.hub.asks.subscribe ?? NEVER, pill ? pill.hub.asks.getSnapshot : () => NO_ASKS);
  const persona = useSyncExternalStore(pill?.hub.persona.subscribe ?? NEVER, pill ? pill.hub.persona.getSnapshot : () => DEFAULT_PERSONA);
  const field: Pick<FieldState, "open" | "output"> = useSyncExternalStore(pill?.field.subscribe ?? NEVER, pill ? pill.field.getSnapshot : () => NO_FIELD);
  if (!pill) return null;
  // The default purple follows the appearance (lighter in Dark); a colour the person chose is theirs.
  const colour = persona.colour.toLowerCase() === DEFAULT_PERSONA.colour.toLowerCase() ? agent : persona.colour;
  return { source: pill, jobs, speaking, asks, colour, glyph: markSvg(persona.mark), name: persona.name, fieldOpen: field.open && field.output === output };
}

/** The jobs beside the mark (job-capsule.tsx): never hidden, they shrink to discs and a count instead (bar-jobs.ts). */
export function jobsSlot({ sources, appName, pill }: ProgramContext, room: number | null, onWidth: (width: number) => void, accessible: boolean): StatusSlot[] {
  const { menus, output, reduceMotion = () => false } = sources;
  if (!pill || pill.jobs.length === 0) return [];
  const row = layoutJobs(pill.jobs, pill.speaking, room);
  const panel = (right: number, focus: string | null) => void menus.toggleAgents(appName, right, focus, output);
  const open = (job: BarJob, right: number) => {
    // A question is the card's (the capsule piece): the bar only opens it. With no card, a plan is answered in the launcher.
    if (job.state === "need" && job.ask !== undefined && pill.source.hub.voiceCommands.send({ do: "open-ask", id: job.ask })) return;
    if (job.state === "need" && job.kind === "task") return pill.source.showTask(job.id);
    pill.source.jobs.looked(job);
    panel(right, job.kind === "task" ? taskFocus(job.id) : job.id);
  };
  const all = (right: number) => {
    pill.source.jobs.lookedAll();
    panel(right, null);
  };
  const voice = row.capsules.at(-1)?.job;
  return [
    {
      key: "jobs",
      goes: null,
      label: voice ? jobLabel(voice) : "Jobs",
      radius: 10,
      open: { kind: "panel" as const, run: (bounds: Bounds | null) => all(bounds ? bounds.x + bounds.width : 0) },
      node: (
        <View onLayout={(bounds) => onWidth(bounds.width)}>
          <JobsRow
            row={row}
            dashi={pill.colour}
            glyph={pill.glyph}
            onOpen={open}
            onStop={(job) => job.kind === "task" && pill.source.stopTask(job.id)}
            onMore={(right) => all(right)}
            reduceMotion={reduceMotion}
            accessible={accessible}
          />
        </View>
      ),
    },
  ];
}

/** Dashi's mark: always there, leading the status items. A click (or the keyboard) turns the row into the field. */
export function agentMarkSlot({ sources, mark, pill, tip }: ProgramContext, accessible: boolean): StatusSlot[] {
  const { output } = sources;
  const need = pill ? needCount(pill.jobs, pill.asks) : 0;
  const name = pill?.name ?? "Dashi";
  const label =
    need > 0 ? `${name}: ${need} ${need === 1 ? "job needs" : "jobs need"} you` : mark.kind === "none" ? `Ask ${name}` : `Ask ${name}. ${mark.label}`;
  const openField = () => pill?.source.field.toggle(output);
  return [
    {
      key: "agent-mark",
      goes: null,
      label,
      radius: 11,
      open: { kind: "action" as const, run: openField },
      node: (
        <AgentMark
          need={need}
          watching={mark.kind !== "none" && mark.watching}
          open={pill?.fieldOpen === true}
          {...(pill ? { colour: pill.colour, glyph: pill.glyph } : {})}
          label={label}
          tip={mark.kind === "none" ? "" : mark.tip}
          onPress={openField}
          onTip={tip}
          accessible={accessible}
        />
      ),
    },
  ];
}
