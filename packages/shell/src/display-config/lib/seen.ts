/**
 * The arrangement each set of monitors last ran in this session, saved or
 * not (decisions.md D538): what a set with nothing saved comes back to when
 * a monitor is unplugged and plugged back, so the main display that went
 * comes back main, where it was, at the mode it ran; and the main display
 * the person last had among several, for a set never seen. Kept in memory
 * only: what is written to `displays.json` is what a person or an agent chose.
 */

import { identityOf, type Monitor, setKey } from "../monitors.ts";
import { layoutOf } from "../plan.ts";
import type { SavedLayout } from "../saved.ts";

export class SeenLayouts {
  private readonly layouts = new Map<string, SavedLayout>();
  /** The identity of the main display when there last was a choice of one (two screens lit or more). */
  private main: string | null = null;

  /**
   * The monitors as they run now, settled. A set with a monitor off or
   * without a place (going, coming, mirroring) is not noted: a screen
   * on its way out never comes back off.
   */
  note(monitors: readonly Monitor[], lidClosed: boolean): void {
    const own = monitors.filter((monitor) => monitor.mirrorOf === undefined);
    if (own.length === 0 || own.some((monitor) => !monitor.enabled || !monitor.mode || !monitor.frame)) return;
    const key = setKey(monitors);
    const layout = layoutOf(monitors, this.layouts.get(key), lidClosed);
    this.layouts.set(key, layout);
    if (own.length > 1 && layout.primary) this.main = layout.primary;
  }

  get(key: string): SavedLayout | undefined {
    return this.layouts.get(key);
  }

  /** The main display the person last had among several, if it is one of `monitors`. */
  previousMain(monitors: readonly Monitor[]): string | undefined {
    return monitors.find((monitor) => identityOf(monitor) === this.main)?.name;
  }
}
