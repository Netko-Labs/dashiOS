/**
 * The shell's action registry, filled from its sources (docs/actions.md):
 * the agents' tools, Dashi's own commands, Settings, the apps installed and
 * their Desktop Actions, the windows open, and the menus running apps
 * publish. Its one runner carries an action out for the person: the
 * launcher, a key the keymap binds to an address, and a `dashi://` link
 * from outside (links.ts) all come through `run`.
 */

import { actingAs } from "../acting.ts";
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
import type { MenuAction } from "../menus/index.ts";
import { type RegistryStores, type RowDef, type SettingValue, valueOf } from "../settings-app/registry/index.ts";
import type { PaneId } from "../shared/settings/panes.ts";
import { isPaneId } from "../shared/settings/panes.ts";
import type { Arrow } from "../tiling.ts";
import { withArgs } from "./address.ts";
import { type PersonQuestion, personTitle } from "./confirm-sheet.tsx";
import { copyAddress } from "./lib/copy.ts";
import { linksSocketPath, serveLinks } from "./lib/links.ts";
import { type Origin, type RunDeps, runAction } from "./lib/run.ts";
import { AppSource } from "./lib/sources/apps.ts";
import { commandActions, type RunCapture } from "./lib/sources/commands.ts";
import { MenuSource } from "./lib/sources/menus.ts";
import { settingsActions } from "./lib/sources/settings.ts";
import { WindowSource } from "./lib/sources/windows.ts";
import { ActionRegistry, fixedSource, mayUse } from "./registry.ts";
import { type ActionContext, type ActionDef, type ActionSource, type Args, failed, type Outcome } from "./types.ts";

export interface ActionsOptions {
  compositor: Compositor | null;
  /** The agents' server: the tools run as the person through it. */
  agents: Pick<Agents, "runAsPerson" | "desktop"> | null;
  /** The settings registry's stores: Settings' rows read their state and change through them; null in a session without them. */
  settingsStores?: RegistryStores | null;
  /** The person's own sheet (agent-sheets.tsx): only their press answers yes. */
  confirmPerson(question: PersonQuestion): Promise<boolean>;
  /** The installed apps (the shell's catalog). */
  entries(): readonly Entry[];
  launch(entry: Entry): number | null;
  /** Bring a running app's window forward (lib/sources/apps.ts); whether it did. */
  activate?(entry: Entry): Promise<boolean>;
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
  /** A screenshot, ⇧❖3 ⇧❖4 ⇧❖5's (lib/sources/commands.ts); none without a compositor. */
  capture?: RunCapture;
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
  /**
   * A step of an agent's plan the person approved with their own press
   * (agents/ask/tasks.ts): that press is its Allow Once. Only an agents'
   * tool runs so; it is logged as `by.agent`'s, in task `by.task`. A tool that
   * asks every time still asks, on the person's sheet.
   */
  runApproved(action: ActionDef, args: Args, by: { agent: string; task: string }): Promise<Outcome>;
  close(): void;
}

/** What the person's sheet asks for a tool's question ("force “Notes” to quit"). */
const fromTool = (question: Question): PersonQuestion => ({
  title: personTitle(question.summary),
  detail: question.detail,
  action: question.action,
  // Red only for what the tool says loses work or can't be taken back ("Show Copies" is not).
  danger: question.danger === true,
});

/** What the sources read of the compositor: the windows open, when they change, and focus. */
function windowView(compositor: Compositor | null) {
  return {
    windows: async (): Promise<readonly CompositorWindow[]> => (compositor ? compositor.windows().catch(() => []) : []),
    onWindows: (listener: () => void): (() => void) =>
      compositor?.on((event) => {
        if (event.event === "window-opened" || event.event === "window-closed") listener();
      }) ?? (() => {}),
    focus: async (window: number): Promise<void> => {
      await compositor?.focus({ window });
    },
  };
}

/** The settings source: its rows read and change through the registry's stores. */
function settingsSource(options: ActionsOptions): ActionSource {
  const stores = options.settingsStores;
  return fixedSource(
    "settings",
    settingsActions({
      state: (row) => (stores ? valueOf(row, stores) : null),
      ...(stores ? { set: (row: RowDef, value: SettingValue) => row.value?.set(stores, value) } : {}),
      open: (pane, row) => {
        if (isPaneId(pane)) options.openSettings(pane, row);
      },
    }),
  );
}

/** Every source the registry is filled from; the two that watch (windows, menus) come back to be closed. */
function addSources(registry: ActionRegistry, options: ActionsOptions): { windowSource: WindowSource; menuSource: MenuSource } {
  const { windows, onWindows, focus } = windowView(options.compositor);
  registry.add(fixedSource("tools", TOOL_ACTIONS));
  registry.add(fixedSource("dashi", commandActions(options.runMenu, options.keymap, options.capture)));
  registry.add(settingsSource(options));
  registry.add(new AppSource({ entries: options.entries, launch: options.launch, ...(options.activate ? { activate: options.activate } : {}) }));
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
  return { windowSource, menuSource };
}

/** The tools as the person: a question an agent would be asked is the person's sheet, and No is "Cancelled." */
function toolContext({ agents, confirmPerson }: ActionsOptions): (window: number | null) => ActionContext {
  return (window) => ({
    window,
    ...(agents
      ? {
          tool: async (call) => {
            let declined = false;
            const result = await agents.runAsPerson(call, async (question) => {
              const yes = await confirmPerson(fromTool(question));
              declined = !yes;
              return yes;
            });
            return declined ? { content: [{ type: "text", text: "Cancelled." }], isError: true } : result;
          },
        }
      : {}),
  });
}

/** A step of an agent's plan the person approved: run as the tool, logged as the agent's. */
async function runApprovedStep(action: ActionDef, args: Args, by: { agent: string; task: string }, context: ActionContext): Promise<Outcome> {
  if (action.tool === undefined || !mayUse(action, "agents")) return failed("Agents can't use this.");
  const checked = action.check(args);
  if (!checked.ok) return failed(checked.error);
  let outcome: Outcome;
  try {
    // The person approved it, but the answerer chose it: what it changes is listed as the answerer's (acting.ts).
    outcome = await actingAs({ agent: by.agent }, () => checked.run(context));
  } catch (error) {
    outcome = failed(`${action.title} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const word = outcome.ok ? "ok" : outcome.error === "Cancelled." ? "cancelled" : "error";
  logActivity({ agent: by.agent, claims: null, tool: action.address, outcome: word, task: by.task });
  return outcome;
}

export function startActions(options: ActionsOptions): Actions {
  const registry = new ActionRegistry();
  const { windowSource, menuSource } = addSources(registry, options);
  void registry.refresh();

  let present: ((action: ActionDef, args: Args) => boolean) | null = null;

  const context = toolContext(options);

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
    runApproved: (action, args, by) => runApprovedStep(action, args, by, context(null)),
    close() {
      stopLinks();
      windowSource.close();
      menuSource.close();
      registry.close();
    },
  };
}
