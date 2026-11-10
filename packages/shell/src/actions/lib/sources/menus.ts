/**
 * The menus running apps publish (app-menus/) as actions: "Notes › File ›
 * New Note" at `dashi://app/dev.dashi.notes/menu/new`, with the item's own
 * shortcut, so choosing one teaches the key. Choosing sends the menu's own
 * select, as a click in the menu bar does, after bringing the app's window
 * forward. Items an app keeps from agents (`agents: false`) are offered: the
 * person is choosing. Items greyed out now are left out.
 *
 * An app's item can change or delete something, so a link only opens one
 * (`destructive`), never chooses it.
 */

import type { AppMenuStore } from "../../../app-menus/store.ts";
import type { CompositorWindow } from "../../../compositor.ts";
import type { PublishedMenus } from "../../../shared/app-menus/protocol.ts";
import { formatAddress, isSegment } from "../../address.ts";
import { type ActionDef, type ActionSource, failed, ok, ready } from "../../types.ts";

export interface MenuDeps {
  store: Pick<AppMenuStore, "published" | "onPublished" | "select">;
  windows(): Promise<readonly CompositorWindow[]>;
  /** Hear that windows opened or closed. */
  onWindows?(listener: () => void): () => void;
  /** The processes a window's menus may come from: its own, then its parent (app-menus/focus.ts `ownerPids`). */
  owners(pid: number | null): number[];
  appName(window: CompositorWindow): string;
  focus(window: number): Promise<void>;
}

/** Who published: the app (by its windows' app id and name) and its front window. */
export interface MenuApp {
  appId: string;
  name: string;
  window: number | null;
}

/** One process's published menus as actions. */
export function menuActions(published: PublishedMenus, app: MenuApp, deps: Pick<MenuDeps, "store" | "focus">): ActionDef[] {
  if (!isSegment(app.appId)) return [];
  return published.menus.flatMap((menu) =>
    menu.items.flatMap((row): ActionDef[] => {
      if (row.kind !== "item" || !row.enabled) return [];
      const path = [app.name, menu.title, row.label].filter((part) => part !== "");
      return [
        {
          address: formatAddress(["app", app.appId, "menu", row.id]),
          title: path.join(" › "),
          description: "",
          keywords: { en: [row.label.toLowerCase(), menu.title.toLowerCase(), app.name.toLowerCase()].filter(Boolean) },
          kind: row.checked === undefined ? "run" : "toggle",
          properties: {},
          scope: "act",
          readOnly: false,
          // The app decides what its item does; it may delete something.
          destructive: true,
          who: "person",
          source: "menus",
          ...(row.shortcut ? { shortcut: row.shortcut } : {}),
          ...(row.checked === undefined ? {} : { state: () => row.checked ?? false }),
          check: () =>
            ready(async () => {
              if (app.window !== null) await deps.focus(app.window);
              return deps.store.select(published.pid, row.id) ? ok(`Chose ${path.join(" › ")}.`) : failed(`“${row.label}” can't be chosen now.`);
            }),
        },
      ];
    }),
  );
}

/** Which app published `pid`'s menus: a window of that process or of a child (a Metal app's host). */
export function appOf(pid: number, windows: readonly CompositorWindow[], deps: Pick<MenuDeps, "owners" | "appName">): MenuApp | null {
  const window = windows.find((each) => each.pid !== null && deps.owners(each.pid).includes(pid));
  return window ? { appId: window.appId, name: deps.appName(window), window: window.id } : null;
}

/** Publishes closer together than this are read once (an app may publish on every keystroke). */
const SETTLE_MS = 100;

/** Every running app's menus, read again when one publishes or a window comes or goes. */
export class MenuSource implements ActionSource {
  readonly id = "menus";
  private current: ActionDef[] = [];
  private readonly listeners = new Set<() => void>();
  private serial = 0;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private readonly offs: Array<() => void>;

  constructor(private readonly deps: MenuDeps) {
    const soon = () => {
      this.pending ??= setTimeout(() => {
        this.pending = null;
        void this.refresh().catch((error) => console.error("dashi-shell: actions from menus:", error));
      }, SETTLE_MS);
    };
    this.offs = [deps.store.onPublished(soon), deps.onWindows?.(soon) ?? (() => {})];
  }

  actions = (): readonly ActionDef[] => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async refresh(): Promise<void> {
    const serial = ++this.serial;
    const windows = await this.deps.windows();
    if (serial !== this.serial) return;
    this.current = this.deps.store.published().flatMap((published) => {
      const app = appOf(published.pid, windows, this.deps);
      return app ? menuActions(published, app, this.deps) : [];
    });
    for (const listener of this.listeners) listener();
  }

  close(): void {
    for (const off of this.offs) off();
    if (this.pending) clearTimeout(this.pending);
  }
}
