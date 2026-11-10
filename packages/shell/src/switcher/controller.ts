/**
 * The switcher's session, from ❖Tab until ❖ comes up: Tab and ⇧Tab step
 * through apps, a short hold on one (or ↓, `) shows its windows under the
 * row, typing narrows apps and windows, Q H M W act on the selection, Esc
 * cancels, and letting ❖ go brings the chosen window forward. The panel
 * shows once ❖Tab has been held a moment, so a quick ❖Tab flips to the last
 * app without it. While a session is open its keys are bound (keymap.ts
 * `withSwitcher`); everything runs in order, so a quick ❖Tab can't commit
 * before its step.
 */

import type { Compositor, CompositorWindow } from "../compositor.ts";
import { switcherLayout, switcherSize } from "./layout.ts";
import {
  type AppGroup,
  chosenWindow,
  filterApps,
  groupByApp,
  isAway,
  ROW_WINDOWS,
  type Selection,
  type Step,
  type SwitcherAction,
  stepSelection,
  switcherKey,
  visibleWindows,
} from "./model.ts";
import type { SwitcherHost, SwitcherKeys, SwitcherState } from "./surface.ts";

export type { SwitcherApp, SwitcherHost, SwitcherKeys, SwitcherState, SwitcherWindow } from "./surface.ts";

/** A ❖Tab held this long shows the panel. */
const SHOW_AFTER_MS = 150;
/** Resting on an app this long shows its windows. */
const HOLD_MS = 550;

interface Session {
  all: AppGroup[];
  shown: AppGroup[];
  selection: Selection;
  query: string;
  visible: boolean;
  windowsShown: boolean;
  size: { width: number; height: number };
  /** Windows the person hid or minimized in this session (H, M): letting go of ❖ on one doesn't bring it back. */
  putAway: Set<number>;
  timer?: ReturnType<typeof setTimeout>;
  hold?: ReturnType<typeof setTimeout>;
}

export class SwitcherController {
  private session: Session | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly compositor: Pick<Compositor, "close" | "hide" | "minimize" | "focus" | "windows">,
    private readonly host: SwitcherHost,
    /** What an app is called (the Dock's name), for typing to find it. */
    private readonly nameOf: (group: AppGroup) => string = (group) => group.appId,
    private readonly keys: SwitcherKeys = { begin() {}, end() {} },
    /** The chosen window's app was brought forward: the launcher's ranking counts it (launcher/ranking/). */
    private readonly opened: (window: CompositorWindow) => void = () => {},
  ) {}

  /** Tab, ⇧Tab, and the arrows (only Tab and ⇧Tab start a session). */
  step(step: Step): void {
    this.enqueue(() => this.move(step));
  }

  /** A key typed while ❖ is held (`switcher-key`), or ⌫ (`erase`). */
  type(key: string): void {
    this.enqueue(async () => this.typed(key));
  }

  erase(): void {
    this.enqueue(async () => {
      const session = this.session;
      if (!session || session.query === "") return;
      this.refilter(session, session.query.slice(0, -1));
    });
  }

  /** The pointer over app `app` (and window `window` of its row): that is the selection. */
  point(app: number, window: number | null = null): void {
    this.enqueue(async () => {
      const session = this.session;
      if (!session || app >= session.shown.length) return;
      this.select(session, { app, window });
    });
  }

  /** A click: choose that and finish. */
  pick(app: number, window: number | null = null): void {
    this.point(app, window);
    this.commit();
  }

  cancel(): void {
    this.enqueue(() => this.end(false));
  }

  /** ❖ came up: bring the chosen window forward. */
  commit(): void {
    this.enqueue(() => this.end(true));
  }

  private enqueue(operation: () => Promise<void>): void {
    this.queue = this.queue.then(operation).catch((error) => console.error("dashi-shell: switcher:", error));
  }

  private state(session: Session): SwitcherState {
    const { shown, selection } = session;
    const group = shown[selection.app];
    const [start, end] = visibleWindows(group?.windows.length ?? 0, selection.window);
    const windows = session.windowsShown && group ? group.windows.slice(start, end).map(({ id, title, state }) => ({ id, title, state })) : null;
    return {
      apps: shown.map((each) => ({ appId: each.appId, title: each.title, count: each.windows.length, away: isAway(each) })),
      selected: selection.app,
      windows,
      windowStart: start,
      selectedWindow: windows && selection.window !== null ? selection.window - start : null,
      query: session.query,
      size: session.size,
    };
  }

  /** Show what changed, and where the window pictures go. */
  private publish(session: Session): void {
    if (!session.visible) return;
    const state = this.state(session);
    this.host.show(state);
    const rects = switcherLayout(state.size.width, state.apps.length, state.windows?.length ?? 0).windows;
    this.host.pictures?.((state.windows ?? []).flatMap((window, index) => (rects[index] ? [{ window: window.id, rect: rects[index] }] : [])));
  }

  private select(session: Session, selection: Selection): void {
    const appChanged = selection.app !== session.selection.app;
    session.selection = selection;
    if (selection.window !== null) session.windowsShown = true;
    else if (appChanged) session.windowsShown = false;
    if (appChanged || session.hold === undefined) this.holdOn(session);
    this.publish(session);
  }

  /** After a rest on the same app, its windows show. */
  private holdOn(session: Session): void {
    clearTimeout(session.hold);
    const app = session.selection.app;
    session.hold = setTimeout(() => {
      if (this.session !== session || session.selection.app !== app) return;
      session.windowsShown = true;
      this.publish(session);
    }, HOLD_MS);
  }

  private async move(step: Step): Promise<void> {
    const current = this.session;
    if (current) {
      this.select(current, stepSelection(current.selection, current.shown, step));
      return;
    }
    if (step !== "next" && step !== "previous") return;
    const all = groupByApp(await this.compositor.windows());
    const windows = all.reduce((sum, group) => sum + group.windows.length, 0);
    if (all.length < 2 && windows < 2) return;
    const most = Math.min(ROW_WINDOWS, Math.max(...all.map((group) => group.windows.length)));
    const session: Session = {
      all,
      shown: all,
      selection: stepSelection({ app: 0, window: null }, all, step),
      query: "",
      visible: false,
      windowsShown: false,
      size: switcherSize(all.length, most),
      putAway: new Set(),
    };
    this.session = session;
    this.keys.begin();
    session.timer = setTimeout(() => {
      if (this.session !== session) return;
      session.visible = true;
      this.publish(session);
    }, SHOW_AFTER_MS);
    this.holdOn(session);
  }

  private typed(key: string): void {
    const session = this.session;
    if (!session) return;
    const meant = switcherKey(key, session.query);
    if (!meant) return;
    if (meant.kind === "act") {
      void this.act(session, meant.action).catch((error) => console.error("dashi-shell: switcher action:", error));
      return;
    }
    // Typing shows the panel at once: the person is looking for something.
    session.visible = true;
    this.refilter(session, session.query + meant.text);
  }

  private refilter(session: Session, query: string): void {
    session.query = query;
    session.shown = filterApps(session.all, query, this.nameOf);
    // The first match is the choice; a search shows its windows at once.
    session.selection = { app: 0, window: null };
    session.windowsShown = query.trim() !== "";
    this.holdOn(session);
    this.publish(session);
  }

  /** Q, H, M, W: quit or hide the app, minimize or close the window; the session goes on with what is left. */
  private async act(session: Session, action: SwitcherAction): Promise<void> {
    const group = session.shown[session.selection.app];
    const target = chosenWindow(session.shown, session.selection);
    if (!group || !target) return;
    const whole = session.all.find((each) => each.windows.some((window) => window.id === target.id)) ?? group;
    const tell = (method: "close" | "hide" | "minimize", window: number) => this.compositor[method]({ window }).catch(() => {});
    switch (action) {
      case "quit":
        // Every window of the app is asked to close (its own save prompts still show).
        for (const window of whole.windows) await tell("close", window.id);
        this.forget(session, (window) => whole.windows.includes(window));
        break;
      case "hide":
        for (const window of whole.windows.filter((each) => each.state === "normal")) {
          await tell("hide", window.id);
          session.putAway.add(window.id);
        }
        this.restate(session, (window) => whole.windows.includes(window) && window.state === "normal", "hidden");
        break;
      case "minimize":
        await tell("minimize", target.id);
        session.putAway.add(target.id);
        this.restate(session, (window) => window.id === target.id, "minimized");
        break;
      case "close":
        await tell("close", target.id);
        this.forget(session, (window) => window.id === target.id);
        break;
    }
    session.shown = filterApps(session.all, session.query, this.nameOf);
    if (session.shown.length === 0) {
      await this.end(false);
      return;
    }
    // The selection stays where it was, on what is left there.
    const app = Math.min(session.selection.app, session.shown.length - 1);
    const count = session.shown[app]?.windows.length ?? 0;
    const window = session.selection.window === null || count === 0 ? null : Math.min(session.selection.window, count - 1);
    session.selection = { app, window };
    this.publish(session);
  }

  private forget(session: Session, gone: (window: CompositorWindow) => boolean): void {
    session.all = session.all
      .map((group) => ({ ...group, windows: group.windows.filter((window) => !gone(window)) }))
      .filter((group) => group.windows.length > 0);
  }

  private restate(session: Session, which: (window: CompositorWindow) => boolean, state: CompositorWindow["state"]): void {
    session.all = session.all.map((group) => ({ ...group, windows: group.windows.map((window) => (which(window) ? { ...window, state } : window)) }));
  }

  private async end(commit: boolean): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.session = null;
    clearTimeout(session.timer);
    clearTimeout(session.hold);
    this.keys.end();
    if (session.visible) {
      this.host.pictures?.([]);
      this.host.hide();
    }
    const chosen = chosenWindow(session.shown, session.selection);
    // Focusing a minimized or hidden window brings it back too, unless the person just put it away (H, M).
    if (commit && chosen && !session.putAway.has(chosen.id)) {
      this.opened(chosen);
      await this.compositor.focus({ window: chosen.id });
    }
  }
}
