/** What a press on a widget opens (widgets/api.md § 6): its app, or nothing. The area closes first. */

import { launch, ownApp, SETTINGS_APP_ID } from "../apps.ts";
// The calendar's index would load its service, which loads notifications, which load the area and these widgets: a cycle.
import { calendarBridge } from "../calendar/bridge.ts";
import { dayOf } from "../shared/calendar/index.ts";
import type { Placement } from "./types.ts";

const app = (id: string) => (): void => {
  const found = ownApp(id);
  if (found) launch(found);
};

export function openerOf(placement: Pick<Placement, "kind">): (() => void) | null {
  switch (placement.kind) {
    case "calendar":
    case "rundown":
      return () => calendarBridge()?.openDay(dayOf(new Date()));
    case "notes":
      return app("dev.dashi.notes");
    case "system":
      return app("dev.dashi.activity-monitor");
    case "battery":
      return app(SETTINGS_APP_ID);
    default:
      return null;
  }
}

/**
 * What a press on the lock screen opens once the password is in: the
 * widget's app when it has one, else the notification area, where every
 * widget lives (pass 49: the lock's row had no press, and most cards had
 * nothing to open, so a press did nothing at all).
 */
export function lockOpenerOf(placement: Pick<Placement, "kind">, openArea: () => void): { run: () => void; where: "app" | "area" } {
  const run = openerOf(placement);
  return run ? { run, where: "app" } : { run: openArea, where: "area" };
}
