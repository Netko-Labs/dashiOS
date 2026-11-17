/** What a press on a widget opens (widgets/api.md § 6): its app, or nothing. The area closes first. */

import { launch, ownApp } from "../apps.ts";
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
    default:
      return null;
  }
}
