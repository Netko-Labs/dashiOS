/**
 * Dashi's mark, the jobs and the field, started for every menu bar
 * (boot/bars.tsx): the jobs' store over the launcher's Ask tasks, the runs
 * and the connected agents; the field's state, and its surface over the
 * bar's row (lib/field-row.tsx). The field gives way to a menu, a panel or
 * the launcher, as they give way to it.
 */

import type { AgentInfo, RunView, TaskView } from "../agents/index.ts";
import type { OpenOverlay } from "../overlay.tsx";
import type { PillHub } from "../shared/pill/index.ts";
import { holdingBar } from "./bar-hold.ts";
import { BarField, type FieldAsker } from "./field.ts";
import { BarJobs } from "./jobs.ts";
import { FieldRow } from "./lib/field-row.tsx";
import type { StatusSources } from "./lib/menubar-program-slots.tsx";
import type { BarPill } from "./pill.ts";

interface Source<T> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): T;
}

/** The layer namespace of the field's surface. */
export const FIELD_LAYER = "dashi.barfield";

export interface BarPillNeeds {
  hub: PillHub;
  open: OpenOverlay;
  /** The launcher's Ask tasks, once they have started: read, stopped, and asked. */
  tasks(): (Source<readonly TaskView[]> & { stop(id: string): void }) | null;
  asker(): FieldAsker | null;
  agents: Source<readonly AgentInfo[]>;
  runs: Source<readonly RunView[]>;
  /** The bar's menus: an open one closes as the field opens, and the field closes as one opens. */
  menus: Source<{ popover: unknown; bar?: unknown }> & { close(): void };
  /** The primary screen's name, for a field opened by another piece. */
  primary(): string | undefined;
  /** The screen locked: `listener` runs; the returned function stops it. */
  onLock(listener: () => void): () => void;
  /** The window in front changed (one opened or closed, another Space, the switcher, Mission Control): `listener` runs; the returned function stops it. */
  onFront(listener: () => void): () => void;
  /** The launcher, where a plan with no card is answered. */
  showLauncher(): void;
  /** What a bar's status side is built from, for the signs that stay in the row. */
  bar(output: string | undefined): StatusSources;
}

export function startBarPill(needs: BarPillNeeds): { pill: BarPill; stop(): void } {
  const { hub } = needs;
  const jobs = new BarJobs({ tasks: needs.tasks, agents: needs.agents, runs: needs.runs, asks: hub.asks });
  // The row holds the keyboard, so no window is focused: the bar under it keeps the app's name and menus (bar-hold.ts).
  const open = holdingBar(needs.open);
  const field = new BarField({
    bar: hub.bar,
    commands: hub.barCommands,
    asker: needs.asker,
    closeMenus: () => needs.menus.close(),
    defaultOutput: needs.primary,
    jobs: { subscribe: jobs.subscribe, count: () => jobs.getSnapshot().jobs.length },
    openSurface: (output, onClosed) =>
      open(
        {
          title: "Ask Dashi",
          width: 1,
          height: 1,
          surface: {
            layer: "overlay",
            anchor: ["top", "bottom", "left", "right"],
            // Over the bar's own row, not pushed down by its zone.
            exclusiveZone: -1,
            // Exclusive, so the caret is in the row as soon as it opens.
            keyboard: "exclusive",
            namespace: FIELD_LAYER,
            ...(output === undefined ? {} : { output }),
          },
        },
        <FieldRow field={field} persona={hub.persona} bar={needs.bar(output)} />,
        onClosed,
      ),
  });
  // A menu or a panel opening (the clock in the row, ⌃F2) takes the field's place.
  const stopMenus = needs.menus.subscribe(() => {
    const { popover, bar } = needs.menus.getSnapshot();
    if (popover !== null || bar !== undefined) field.close();
  });
  // The Dashi key opens the launcher or listens: the row gives the keyboard up, the draft kept.
  const stopKeys = hub.keys.listen((gesture) => {
    if (gesture.key === "dashi" && (gesture.gesture === "tap" || gesture.gesture === "hold")) field.close();
  });
  const stopLock = needs.onLock(() => field.close());
  // The words were for what was in front: when that changes the row gives the keyboard up, the draft kept.
  const stopFront = needs.onFront(() => field.close());
  return {
    pill: {
      hub,
      jobs,
      field,
      stopTask: (id) => needs.tasks()?.stop(id),
      showTask: () => needs.showLauncher(),
    },
    stop() {
      stopMenus();
      stopKeys();
      stopLock();
      stopFront();
      field.stop();
      jobs.close();
    },
  };
}
