/**
 * Screen sharing: who may capture the screen, and the indicator while
 * something does. The compositor serves wlr-screencopy (what
 * xdg-desktop-portal-wlr uses for Meet, Zoom, Teams, OBS) and enforces one
 * rule: only programs on a list may even see the protocol. The list is
 * decided here: the portal's binaries, plus any `screenSharing.clients` in
 * settings.json (absolute paths of programs that capture directly, like
 * grim or wf-recorder, which the person trusts):
 *
 *   { "screenSharing": { "clients": ["/usr/bin/grim"] } }
 *
 * While frames flow the compositor sends `screen-capture {active}`, and the
 * menu bar shows "Screen is being shared" (screen-capture.tsx). Nothing
 * hides it: an app's own request is only ever served through the portal,
 * which asks the person first.
 *
 * A shell that starts while something is capturing learns it from `active` in
 * the answer to `screencopy-clients`, so the pill shows at once after a shell
 * restart. (A compositor that predates `active` leaves the default, not shared,
 * until the next event.)
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { useSyncExternalStore } from "react";
import type { Compositor } from "./compositor.ts";

/** Where distributions install xdg-desktop-portal-wlr: Fedora's libexec, Arch's and Debian's lib. */
export const PORTAL_CLIENTS: readonly string[] = ["/usr/libexec/xdg-desktop-portal-wlr", "/usr/lib/xdg-desktop-portal-wlr"];

/** The compositor refuses more than this many paths. */
const MAX_CLIENTS = 64;

/** The portal's binaries and the `screenSharing.clients` of settings.json, strictly read: only absolute path strings count. */
export function parseCaptureClients(settings: unknown): string[] {
  const section = typeof settings === "object" && settings !== null ? (settings as Record<string, unknown>).screenSharing : undefined;
  const listed = typeof section === "object" && section !== null ? (section as Record<string, unknown>).clients : undefined;
  const extra = Array.isArray(listed)
    ? listed.filter((path): path is string => typeof path === "string" && path.startsWith("/") && !path.includes("\0") && path.length <= 4096)
    : [];
  return [...new Set([...PORTAL_CLIENTS, ...extra])].slice(0, MAX_CLIENTS);
}

function readCaptureClients(env: Record<string, string | undefined> = process.env): string[] {
  const config = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  try {
    return parseCaptureClients(JSON.parse(readFileSync(join(config, "dashi", "settings.json"), "utf8")));
  } catch {
    return parseCaptureClients(null);
  }
}

/** Whether the screen is being captured right now, for the menu bar. */
export class ScreenCaptureStore {
  private active = false;
  private readonly listeners = new Set<() => void>();

  set(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): boolean => this.active;
}

export function useScreenCapture(store: ScreenCaptureStore): boolean {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

export interface ScreenCapture {
  /**
   * Let the program at `path` capture too, until the returned function is
   * called: the shell's own recorder (recorder/) runs wf-recorder this way,
   * so it is allowed only while Dashi records.
   */
  allow(path: string): () => void;
  stop(): void;
}

/** Give the compositor the list and follow its events into `store`. */
export function startScreenCapture(
  compositor: Pick<Compositor, "request" | "on">,
  store: ScreenCaptureStore,
  options: { clients?: () => string[] } = {},
): ScreenCapture {
  const clients = options.clients ?? readCaptureClients;
  const extra = new Map<string, number>();
  const stop = compositor.on((event) => {
    if (event.event === "screen-capture") store.set(event.active);
  });
  const send = (): Promise<unknown> => compositor.request("screencopy-clients", { paths: [...new Set([...clients(), ...extra.keys()])].slice(0, MAX_CLIENTS) });
  // A shell that restarts mid-share would otherwise show nothing until the next change:
  // the answer says `active`.
  send()
    .then((answer) => {
      const active = typeof answer === "object" && answer !== null ? (answer as Record<string, unknown>).active : undefined;
      if (typeof active === "boolean") store.set(active);
    })
    .catch((error) => {
      // An older compositor has no screen sharing; there is nothing to indicate either.
      console.log(`dashi-shell: the compositor won't take a screen sharing list: ${error instanceof Error ? error.message : String(error)}`);
    });
  return {
    allow(path) {
      extra.set(path, (extra.get(path) ?? 0) + 1);
      void send().catch(() => {});
      let allowed = true;
      return () => {
        if (!allowed) return;
        allowed = false;
        const count = (extra.get(path) ?? 1) - 1;
        if (count > 0) extra.set(path, count);
        else extra.delete(path);
        void send().catch(() => {});
      };
    },
    stop,
  };
}
