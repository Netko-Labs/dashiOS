/**
 * The shell's action registry, filled from its sources (docs/actions.md):
 * the agents' tools, Dashi's own commands, Settings, the apps installed and
 * their Desktop Actions, the windows open, and the menus running apps
 * publish. Its one runner carries an action out for the person: the
 * launcher, a key the keymap binds to an address, and a `dashi://` link
 * from outside (links.ts) all come through `run`.
 */

import type { Question } from "../agents/confirm.ts";
import { logActivity } from "../agents/consent.ts";
import type { Agents } from "../agents/server.ts";
import { TOOL_ACTIONS } from "../agents/tools/index.ts";
import { ownerPids } from "../app-menus/focus.ts";
import type { AppMenuStore } from "../app-menus/store.ts";
import type { Compositor, CompositorWindow } from "../compositor.ts";
import type { Entry } from "../entries.ts";
import type { Keymap } from "../keymap.ts";
import type { Arrange } from "../layout.ts";
import type { MenuAction } from "../menus/model.ts";
import type { PaneId } from "../settings-app/panes.ts";
import { isPaneId } from "../settings-app/panes.ts";
import type { Arrow } from "../tiling.ts";
import { withArgs } from "./address.ts";
import { type PersonQuestion, personTitle } from "./confirm-sheet.tsx";
import { copyAddress } from "./copy.ts";
import { linksSocketPath, serveLinks } from "./links.ts";
import { ActionRegistry, fixedSource } from "./registry.ts";
import { type Origin, type RunDeps, runAction } from "./run.ts";
import { AppSource } from "./sources/apps.ts";
import { commandActions } from "./sources/commands.ts";
import { MenuSource } from "./sources/menus.ts";
import { type SettingKey, settingState, settingsActions } from "./sources/settings.ts";
import { WindowSource } from "./sources/windows.ts";
import type { ActionContext, ActionDef, Args, Outcome } from "./types.ts";

export interface ActionsOptions {
  compositor: Compositor | null;
  /** The agents' server: the tools run as the person through it, and Settings is read through its desktop. */
  agents: Pick<Agents, "runAsPerson" | "desktop"> | null;
  /** The person's own sheet (agent-sheets.tsx): only their press answers yes. */
  confirmPerson(question: PersonQuestion): Promise<boolean>;
  /** The installed apps (the shell's catalog). */
  entries(): readonly Entry[];
  launch(entry: Entry): number | null;
  appMenus: Pick<AppMenuStore, "published" | "onPublished" | "select">;
  /** What the menu bar calls a window's app. */
  appName(window: CompositorWindow): string;
  /** Arranging windows (arrange.ts); null without a compositor. */
  arrange: {
    arrow(window: number, arrow: Arrow): Promise<void>;
    tile(window: number, to: Arrange): Promise<void>;
    fullscreen(window: number): Promise<void>;
  } | null;
  /** A Dashi menu row's action (menus/start.tsx `run`). */
  runMenu(action: MenuAction): Promise<void>;
  openSettings(pane: PaneId, row?: string): void;
  keymap: Keymap;
  /** Listen for dashi:// links on the links socket; off in tests. */
  serveLinks?: boolean;
}

export interface Actions {
  readonly registry: ActionRegistry;
  /** Run `action` for the person (the launcher); `window` is the one focused when they asked. */
  run(action: ActionDef, args?: Args, window?: number | null): Promise<Outcome>;
  /** A key the keymap binds to an address (keymap.ts): run it for the person, on the window focused when it was pressed; not logged. */
  runAddress(address: string, window: number | null): Promise<Outcome>;
  /** A `dashi://` link from outside: a destructive action is opened, never run (run.ts). */
  openLink(url: string): Promise<Outcome>;
  /** The launcher, once it can show an action with its arguments filled in, takes links that must not run by themselves; null gives them back to the sheet. */
  setPresenter(present: ((action: ActionDef, args: Args) => boolean) | null): void;
  /** Copy Address (the launcher's action list). */
  copyAddress(action: ActionDef, args?: Args): Promise<boolean>;
  close(): void;
}

/** What the person's sheet asks for a tool's question ("force “Notes” to quit"). */
const fromTool = (question: Question): PersonQuestion => ({
  title: personTitle(question.summary),
  detail: question.detail,
  action: question.action,
  danger: true,
});

export function startActions(options: ActionsOptions): Actions {
  const { compositor, agents } = options;
  const registry = new ActionRegistry();
  const windows = async (): Promise<readonly CompositorWindow[]> => (compositor ? compositor.windows().catch(() => []) : []);
  const onWindows = (listener: () => void): (() => void) =>
    compositor?.on((event) => {
      if (event.event === "window-opened" || event.event === "window-closed") listener();
    }) ?? (() => {});
  const focus = async (window: number): Promise<void> => {
    await compositor?.request("focus", { window });
  };

  registry.add(fixedSource("tools", TOOL_ACTIONS));
  registry.add(fixedSource("dashi", commandActions(options.runMenu, options.keymap)));
  const desktop = agents?.desktop;
  registry.add(
    fixedSource(
      "settings",
      settingsActions({
        state: (setting: SettingKey) => (desktop ? settingState(desktop, setting) : null),
        open: (pane, row) => {
          if (isPaneId(pane)) options.openSettings(pane, row);
        },
      }),
    ),
  );
  const apps = new AppSource({ entries: options.entries, launch: options.launch });
  registry.add(apps);
  const arrange = options.arrange;
  const windowSource = new WindowSource({
    windows,
    onChange: onWindows,
    appName: options.appName,
    focus,
    arrow: (window, arrow) => arrange?.arrow(window, arrow) ?? Promise.resolve(),
    tile: (window, to) => arrange?.tile(window, to) ?? Promise.resolve(),
    fullscreen: (window) => arrange?.fullscreen(window) ?? Promise.resolve(),
    keymap: options.keymap,
  });
  registry.add(windowSource);
  const menuSource = new MenuSource({ store: options.appMenus, windows, onWindows, owners: (pid) => ownerPids(pid), appName: options.appName, focus });
  registry.add(menuSource);
  void registry.refresh();

  let present: ((action: ActionDef, args: Args) => boolean) | null = null;

  /** The tools as the person: a question an agent would be asked is the person's sheet, and No is "Cancelled." */
  const context = (window: number | null): ActionContext => ({
    window,
    ...(agents
      ? {
          tool: async (call) => {
            let declined = false;
            const result = await agents.runAsPerson(call, async (question) => {
              const yes = await options.confirmPerson(fromTool(question));
              declined = !yes;
              return yes;
            });
            return declined ? { content: [{ type: "text", text: "Cancelled." }], isError: true } : result;
          },
        }
      : {}),
  });

  const deps: RunDeps = {
    context,
    log: ({ tool, outcome }) => logActivity({ agent: "you", claims: null, tool, outcome }),
    reveal: ({ pane, row }) => {
      if (isPaneId(pane)) options.openSettings(pane, row);
    },
    present: (action, args) => present?.(action, args) ?? false,
    confirmLink: (action, args) =>
      options.confirmPerson({
        title: `Run “${action.title}”?`,
        detail: `A link asked for it: ${withArgs(action.address, args)}`,
        action: "Run",
        danger: action.destructive,
      }),
  };

  const runFrom = async (origin: Origin, text: string, window: number | null): Promise<Outcome> => {
    let found = registry.resolve(text);
    // A window or a menu that appeared since the last read.
    if ("error" in found) {
      await registry.refresh();
      found = registry.resolve(text);
    }
    if ("error" in found) return { ok: false, error: found.error };
    return runAction(found.action, found.args, origin, deps, window);
  };

  const stopLinks =
    options.serveLinks === false
      ? () => {}
      : serveLinks({
          path: linksSocketPath(),
          open: (url) => runFrom("link", url, null),
        });

  return {
    registry,
    run: (action, args = {}, window = null) => runAction(action, args, "person", deps, window),
    runAddress: (address, window) => runFrom("key", address, window),
    openLink: (url) => runFrom("link", url, null),
    setPresenter(next) {
      present = next;
    },
    copyAddress: (action, args = {}) => copyAddress(action, args),
    close() {
      stopLinks();
      windowSource.close();
      menuSource.close();
      registry.close();
    },
  };
}
