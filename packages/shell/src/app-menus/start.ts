/**
 * Apps' own menus in the menu bar (README "Menu bar"): the socket apps
 * publish on, the store the bar reads, and the focus it follows.
 */

import type { Compositor } from "../compositor.ts";
import { menusSocketPath } from "../shared/app-menus/protocol.ts";
import { FocusFollower, ownerPids } from "./focus.ts";
import { serveMenus } from "./lib/server.ts";
import { AppMenuStore } from "./store.ts";

/** After a popover closes, how long the window is given to get the keyboard back before focus is asked again. */
const SETTLE_MS = 250;

export interface AppMenus {
  store: AppMenuStore;
  /** A popover opened (true) or closed: the bar keeps its menus meanwhile. */
  hold(open: boolean): void;
  /** The processes whose menus a window shows (its own, then its parent's). */
  ownersOf(pid: number | null): number[];
  close(): void;
}

export interface AppMenusOptions {
  compositor: Pick<Compositor, "windows"> | null;
  /** The active toplevel (foreign toplevels), and hearing it change. */
  active(): number | null;
  subscribe(listener: () => void): () => void;
  path?: string | null;
}

export function startAppMenus(options: AppMenusOptions): AppMenus {
  const store = new AppMenuStore();
  const stopServing = serveMenus({ path: options.path === undefined ? menusSocketPath() : options.path, store });
  const compositor = options.compositor;
  // Without dashi-comp no window has a process, so no app's menus show.
  const focus = compositor
    ? new FocusFollower({ active: options.active, subscribe: options.subscribe, windows: () => compositor.windows(), onFocus: (pids) => store.setFocus(pids) })
    : null;
  let held = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    store,
    hold(open) {
      if (open === held) return;
      held = open;
      store.hold(open);
      if (timer) clearTimeout(timer);
      timer = open ? null : setTimeout(() => focus?.refresh(), SETTLE_MS);
    },
    ownersOf: (pid) => ownerPids(pid),
    close() {
      if (timer) clearTimeout(timer);
      focus?.close();
      stopServing();
    },
  };
}
