/**
 * Software's sheets: the asks that come before a change (Question, the
 * consent sheet and the trust card, in one queue answered in order), the
 * failure sheet, the screenshot and the catalogs. `focus` is bumped when a
 * sheet closes, so the search field takes the keyboard back.
 */

import { useCallback, useState } from "react";
import type { StoreApplet } from "../../src/shared/applet-store/merge.ts";
import type { AppletState } from "./applets/store.ts";
import type { Services } from "./services.ts";
import type { Answer, Ask } from "./sheets.tsx";

export type WindowAsk = Ask | { kind: "consent"; entry: StoreApplet; update: boolean };

export interface WindowSheets {
  /** The asks waiting; the first is on screen. */
  asks: readonly WindowAsk[];
  enqueue(ask: WindowAsk): void;
  /** Answers the ask on screen, then does what it asked when yes. */
  answer(reply: Answer): void;
  /** The screenshot's file at full size, or null for none. */
  picture: string | null;
  setPicture(file: string | null): void;
  catalogs: boolean;
  openCatalogs(): void;
  closeCatalogs(): void;
  /** Bumped on each close: the search field's key. */
  focus: number;
  refocus(): void;
  closeFailure(): void;
}

type SheetServices = Pick<Services, "store" | "applets" | "restart">;

export function useWindowSheets({ store, applets, restart, appletState }: SheetServices & { appletState: AppletState }): WindowSheets {
  const [asks, setAsks] = useState<WindowAsk[]>([]);
  const [picture, setPicture] = useState<string | null>(null);
  const [catalogs, setCatalogs] = useState(false);
  const [focus, setFocus] = useState(0);
  const refocus = useCallback(() => setFocus((n) => n + 1), []);
  const enqueue = useCallback((ask: WindowAsk): void => setAsks((now) => [...now, ask]), []);

  const answer = (reply: Answer): void => {
    const [current, ...rest] = asks;
    setAsks(rest);
    refocus();
    if (!reply.yes || !current) return;
    switch (current.kind) {
      case "remove":
        return store.remove(current.app, reply.deleteData === true);
      case "remove-applet": {
        const there = appletState.installed.some((each) => each.manifest.id === current.id) || appletState.unreadable.some((each) => each.id === current.id);
        if (there) applets.remove(current, reply.deleteData === true);
        return;
      }
      case "get":
        return store.install(current.id, current.name);
      case "consent":
        return applets.install(current.entry);
      case "system":
        return store.updateSystem();
      case "restart":
        return restart();
    }
  };

  return {
    asks,
    enqueue,
    answer,
    picture,
    setPicture,
    catalogs,
    openCatalogs: () => setCatalogs(true),
    closeCatalogs: () => {
      setCatalogs(false);
      refocus();
    },
    focus,
    refocus,
    closeFailure: () => {
      store.dismissFailure();
      refocus();
    },
  };
}
