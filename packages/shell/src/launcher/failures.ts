/**
 * An app opened from the launcher that quits as it starts: the launcher has
 * closed by then, so a notification says so, with Try again. (One that can't
 * be started at all is a row in the launcher instead: launcher.tsx.)
 */

import type { NotificationStore, NotifyInput } from "../notifications/index.ts";

export const RETRY = "retry";

/** The notice for `name`: what happened, plainly, and the way forward. */
export function failureNotice(name: string): NotifyInput {
  return {
    appName: "Dashi",
    appIcon: "",
    summary: `Couldn't open ${name}`,
    body: "It quit as soon as it started.",
    actions: [{ key: RETRY, label: "Try again" }],
    urgency: "normal",
    expireTimeout: -1,
    imagePath: "",
    desktopEntry: "",
    category: "system",
    transient: false,
    resident: false,
  };
}

export class LaunchFailures {
  private readonly retries = new Map<number, () => void>();
  private readonly stop: () => void;

  constructor(private readonly store: Pick<NotificationStore, "notify" | "onEvent">) {
    this.stop = store.onEvent((event) => {
      if (event.type === "action" && event.key === RETRY) this.retries.get(event.id)?.();
      // An action closes it too, so this comes after the retry.
      if (event.type === "closed") this.retries.delete(event.id);
    });
  }

  /** Say `name` quit as it started; Try again runs `retry`. */
  quit(name: string, retry: () => void): number {
    const id = this.store.notify(failureNotice(name));
    this.retries.set(id, retry);
    return id;
  }

  close(): void {
    this.stop();
    this.retries.clear();
  }
}
