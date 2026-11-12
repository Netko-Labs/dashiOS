/**
 * The app or applet whose page is open, for the File menu's Open, Get,
 * Update and Remove…: what each can do now, and doing it the way the page's
 * own buttons do (sheets first where they ask).
 */

import { useEffect, useState } from "react";
import { useAppletState } from "./applets/rows.tsx";
import { useAppState } from "./hooks.ts";
import type { OpenThing } from "./menus.ts";
import { appAsks } from "./model.ts";
import type { Page } from "./nav.ts";
import type { Actions } from "./parts.tsx";
import { useServices } from "./services.ts";
import { askReasons } from "./trust-words.ts";

export interface OpenThingHandle {
  can: OpenThing;
  open(): void;
  get(): void;
  update(): void;
  remove(): void;
}

/** The open app's name (the catalog's, cached for hours; the id until known) and whether getting it asks first. */
function useAppFacts(id: string | null): { name: string; asks: boolean } | null {
  const { catalog } = useServices();
  const [facts, setFacts] = useState<{ id: string; name: string; asks: boolean } | null>(null);
  useEffect(() => {
    if (id === null) return;
    let current = true;
    catalog
      .details(id)
      .then((answer) => current && setFacts({ id, name: answer.value.name, asks: askReasons(answer.value).length > 0 }))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [catalog, id]);
  if (id === null) return null;
  return facts?.id === id ? facts : { name: id, asks: false };
}

export function useOpenThing(page: Page, actions: Actions): OpenThingHandle | null {
  const { applets } = useServices();
  const appId = page.kind === "app" ? page.id : null;
  const facts = useAppFacts(appId);
  const app = useAppState(appId ?? "");
  const appletState = useAppletState();
  if (appId !== null && facts) {
    const installed = app.kind === "open" || app.kind === "update" ? app.installed : null;
    return {
      can: {
        canOpen: installed !== null,
        canGet: app.kind === "get",
        canUpdate: app.kind === "update",
        canRemove: installed !== null,
        asks: appAsks(app, facts.asks),
      },
      open: () => installed && actions.launch(appId),
      get: () => app.kind === "get" && actions.install(appId, facts.name),
      update: () => app.kind === "update" && actions.update(app.installed, facts.name),
      remove: () => installed && actions.remove(installed),
    };
  }
  if (page.kind === "applet") {
    const entry = applets.entry(page.id);
    const installed = appletState.installed.find((each) => each.manifest.id === page.id) ?? appletState.unreadable.find((each) => each.id === page.id);
    const status = entry ? applets.status(entry) : null;
    const canGet = status?.kind === "get" && status.version !== null;
    const canUpdate = status?.kind === "update" || ((status?.kind === "pulled" || status?.kind === "unreadable") && status.good !== null);
    return {
      can: { canOpen: false, canGet, canUpdate, canRemove: installed !== undefined, asks: entry ? applets.needsConsent(entry) : false },
      open: () => {},
      get: () => entry && canGet && actions.getApplet(entry),
      update: () => entry && canUpdate && actions.getApplet(entry),
      remove: () => installed && actions.removeApplet(installed),
    };
  }
  return null;
}
