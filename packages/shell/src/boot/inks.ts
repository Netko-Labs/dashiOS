/**
 * The Inks widgets (main.tsx, one line): the tally's sources and the
 * widgets' hub, started once. The bar, the notification area, the lock
 * screen and Glance read them; it stops with the shell.
 */

import type { Notifications } from "../notifications/index.ts";
import type { System } from "../system/index.ts";
import { setWidgetHub, WidgetHub } from "../widgets/index.ts";
import type { Handoff } from "./agents.ts";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";

export interface InksNeeds {
  notifications: Notifications;
  system: Pick<System, "store">;
  handoff: Handoff;
  services: Services;
  late: Late<LateParts>;
}

export function startInks({ notifications, system, handoff, services, late }: InksNeeds): WidgetHub {
  const runs = handoff.handoffShell.service.runs;
  const pill = late.get("pill");
  const hub = new WidgetHub({
    notify: (input) => notifications.store.notify(input),
    runs,
    asks: pill.asks,
    system: system.store,
    notices: { subscribe: notifications.store.subscribe, getSnapshot: () => notifications.store.getSnapshot().history },
    openAsk: (id) => void pill.voiceCommands.send({ do: "open-ask", id }),
    stopRun: (id) => handoff.handoffShell.service.stop(id),
    openArea: () => void late.peek("menus")?.controller.toggleNotificationCenter(""),
  });
  setWidgetHub(hub);
  const stop = hub.start();
  services.add("widgets", () => {
    stop();
    setWidgetHub(null);
  });
  return hub;
}
