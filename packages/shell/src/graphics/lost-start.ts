/**
 * The lost-card watch, started: on a two-GPU machine it follows the kernel
 * log for the graphics card (lost-card.ts); when the card falls off the bus
 * it says so once, in a notification with Restart…, and from then on no app
 * is offloaded to it (gpu-env.ts), each one that asked being told in a word.
 */

import { iconPath } from "../apps.ts";
import { markCardLost } from "../gpu-env.ts";
import type { NotificationStore } from "../notifications/store.ts";
import type { NotifyInput } from "../notifications/types.ts";
import { type GraphicsCard, readGraphicsCard } from "./card.ts";
import { LOST_NOTICE, LostCardWatch } from "./lost-card.ts";

const notice = (summary: string, body: string, actions: NotifyInput["actions"] = []): NotifyInput => ({
  appName: "Graphics",
  appIcon: iconPath("settings"),
  summary,
  body,
  actions,
  urgency: actions.length > 0 ? "critical" : "normal",
  expireTimeout: -1,
  imagePath: "",
  desktopEntry: "",
  category: "device.error",
  transient: false,
  resident: false,
});

export interface LostCardStart {
  /** The card watched, null on a one-GPU machine. */
  card: GraphicsCard | null;
  watch: LostCardWatch | null;
  close(): void;
}

export function startLostCardWatch(options: { notifications: NotificationStore; restart: () => void; card?: GraphicsCard | null }): LostCardStart {
  const card = options.card === undefined ? readGraphicsCard() : options.card;
  if (!card) return { card: null, watch: null, close: () => {} };
  const watch = new LostCardWatch(card);
  const { notifications } = options;
  let noticeId = 0;
  const stopActions = notifications.onEvent((event) => {
    if (event.type === "action" && event.id === noticeId && event.key === "restart") options.restart();
  });
  watch.onLost(() => {
    markCardLost((app) =>
      notifications.notify(notice(`${app.name ?? "The app"} is using the built-in graphics`, "The graphics card isn't responding. Restart to use it again.")),
    );
    if (watch.announced) return;
    watch.markAnnounced();
    noticeId = notifications.notify(notice(LOST_NOTICE.summary, LOST_NOTICE.body, [{ key: "restart", label: "Restart…" }]));
  });
  watch.start();
  return {
    card,
    watch,
    close() {
      stopActions();
      watch.close();
    },
  };
}
