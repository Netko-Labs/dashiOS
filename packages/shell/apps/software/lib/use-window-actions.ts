/**
 * What a click in Software does (parts.tsx's Actions): opening a page, getting,
 * launching, updating and removing apps and applets. Each change either runs
 * at once or first asks a question as a sheet (sheets, the trust card, the
 * consent sheet), so the ask goes through `enqueue`.
 */

import type { InstalledApplet, UnreadableApplet } from "@dashi/applet";
import { useMemo } from "react";
import type { StoreApplet } from "../../src/shared/applet-store/index.ts";
import type { InstalledApp } from "../../src/shared/software/index.ts";
import { type Nav, push } from "./nav.ts";
import type { Actions } from "./parts.tsx";
import type { Services } from "./services.ts";
import { appTrust, askReasons } from "./trust-words.ts";
import type { WindowAsk } from "./use-window-sheets.ts";

export interface WindowActionInput extends Pick<Services, "store" | "applets" | "catalog" | "openUrl"> {
  setNav(update: (now: Nav) => Nav): void;
  enqueue(ask: WindowAsk): void;
  setPicture(file: string | null): void;
}

export function useWindowActions({ store, applets, catalog, openUrl, setNav, enqueue, setPicture }: WindowActionInput): Actions {
  return useMemo(
    () => ({
      openApp: (id) => setNav((now) => push(now, { kind: "app", id })),
      openApplet: (id) => setNav((now) => push(now, { kind: "applet", id })),
      install: (id, name) => {
        // The trust card as a sheet first when the app reaches far; one click otherwise (and when Flathub can't say).
        void catalog
          .details(id)
          .then((answer) => answer.value)
          .catch(() => null)
          .then((details) => {
            const reasons = details ? askReasons(details) : [];
            if (details && reasons.length > 0) enqueue({ kind: "get", id, name, facts: appTrust(details), reasons });
            else store.install(id, name);
          });
      },
      launch: (id) => store.open(id),
      update: (app: InstalledApp, name: string) => store.updateApp(app.installation, { id: app.id, name }),
      updateAll: (installation) => store.updateApp(installation),
      remove: (app) => enqueue({ kind: "remove", app }),
      cancel: (key) => store.cancel(key),
      getApplet: (entry: StoreApplet) => {
        if (applets.needsConsent(entry)) enqueue({ kind: "consent", entry, update: applets.status(entry).kind !== "get" });
        else applets.install(entry);
      },
      removeApplet: (applet: InstalledApplet | UnreadableApplet) =>
        enqueue(
          "manifest" in applet
            ? { kind: "remove-applet", id: applet.manifest.id, name: applet.manifest.name }
            : { kind: "remove-applet", id: applet.id, name: applet.name ?? applet.id },
        ),
      openUrl,
      showPicture: setPicture,
    }),
    [store, applets, catalog, openUrl, setNav, enqueue, setPicture],
  );
}
