/**
 * Windows as actions: each open window at `dashi://window/w3` (choosing it
 * brings it forward, on its Desktop), and arranging "the focused window" at
 * `dashi://window/arrange/left` and the like, which the keymap binds ⌃❖←
 * to (keymap.ts). A window's title comes from its app: it is shown and
 * found by, never obeyed.
 */

import { parseWindowId } from "../../../agents/tools/define.ts";
import { ARROWS, type Arrow } from "../../../arrange/index.ts";
import type { CompositorWindow } from "../../../compositor.ts";
import type { Keymap } from "../../../keymap/keymap.ts";
import type { Arrange } from "../../../layout.ts";
import { formatAddress } from "../../address.ts";
import { keyFor } from "../../keys.ts";
import { type ActionDef, type ActionSource, type Args, failed, invalid, ok, ready } from "../../types.ts";

export interface WindowDeps {
  windows(): Promise<readonly CompositorWindow[]>;
  /** Hear that windows opened or closed (the compositor's events). */
  onChange?(listener: () => void): () => void;
  /** What the menu bar calls its app. */
  appName(window: CompositorWindow): string;
  focus(window: number): Promise<void>;
  /** ⌃❖ and an arrow: a half, a quarter, its own size, or the next screen (arrange.ts). */
  arrow(window: number, arrow: Arrow): Promise<void>;
  tile(window: number, to: Arrange): Promise<void>;
  fullscreen(window: number): Promise<void>;
  keymap: Keymap;
}

/** The shell's own surfaces (menus, sheets, the launcher) are not windows to switch to. */
const SHELL_APP_ID = "dev.dashi.shell";

const windowProp = { type: "string", description: 'A window id, like "w3"; the focused window when left out.' };

/** The window an arranging action is for: its `window` argument, or the one focused when the person asked. */
function target(args: Args, focused: number | null): number | string {
  if (args.window === undefined) return focused ?? "No window is focused.";
  return parseWindowId(args.window) ?? `\`${String(args.window)}\` is not a window id; ids look like "w3".`;
}

const ARRANGE: ReadonlyArray<{ id: string; title: string; words: readonly string[]; run(deps: WindowDeps, window: number): Promise<void> }> = [
  ...ARROWS.map((arrow) => ({
    id: arrow,
    title: { left: "Tile window left", right: "Tile window right", up: "Tile window up", down: "Tile window down" }[arrow],
    words: ["tile", "half", "quarter", "snap", arrow],
    run: (deps: WindowDeps, window: number) => deps.arrow(window, arrow),
  })),
  { id: "fill", title: "Fill the screen with the window", words: ["fill", "maximize", "zoom"], run: (deps, window) => deps.tile(window, "fill") },
  { id: "center", title: "Center the window", words: ["center", "middle"], run: (deps, window) => deps.tile(window, "center") },
  {
    id: "restore",
    title: "Give the window its own size back",
    words: ["restore", "unmaximize", "previous size"],
    run: (deps, window) => deps.tile(window, "restore"),
  },
];

/** Arranging the focused window (or a named one): the actions ⌃❖ and an arrow, ↩, C, R, and F are bound to. */
export function arrangeActions(deps: WindowDeps): ActionDef[] {
  const define = (segments: string[], title: string, words: readonly string[], run: (window: number) => Promise<void>): ActionDef => {
    const address = formatAddress(segments);
    const shortcut = keyFor(address, deps.keymap);
    return {
      address,
      title,
      description: "",
      keywords: { en: ["window", "arrange", ...words] },
      kind: "run",
      properties: { window: windowProp },
      scope: "act",
      readOnly: false,
      destructive: false,
      idempotent: false,
      who: "person",
      source: "windows",
      ...(shortcut ? { shortcut } : {}),
      check(args) {
        const window = target(args, null);
        if (typeof window === "string" && args.window !== undefined) return invalid(window);
        return ready(async (ctx) => {
          const id = target(args, ctx.window);
          if (typeof id === "string") return failed(id);
          await run(id);
          return ok(`${title}: w${id}.`);
        });
      },
    };
  };
  return [
    ...ARRANGE.map((each) => define(["window", "arrange", each.id], each.title, each.words, (window) => each.run(deps, window))),
    define(["window", "full-screen"], "Enter or leave full screen", ["full screen", "fullscreen"], (window) => deps.fullscreen(window)),
  ];
}

/** One open window: choosing it brings it forward. */
export function windowAction(window: CompositorWindow, deps: Pick<WindowDeps, "appName" | "focus">): ActionDef {
  const app = deps.appName(window);
  const title = window.title.trim() || app;
  return {
    address: formatAddress(["window", `w${window.id}`]),
    title,
    description: window.state === "minimized" ? "Minimized" : "",
    keywords: { en: [app.toLowerCase(), "window"] },
    kind: "open",
    properties: {},
    scope: "act",
    readOnly: false,
    destructive: false,
    idempotent: true,
    who: "person",
    source: "windows",
    check: () =>
      ready(async () => {
        await deps.focus(window.id);
        return ok(`${app} is in front.`);
      }),
  };
}

/** The windows open now, read again on every change; the arranging actions are always there. */
export class WindowSource implements ActionSource {
  readonly id = "windows";
  private readonly fixed: ActionDef[];
  private open: ActionDef[] = [];
  private readonly listeners = new Set<() => void>();
  private serial = 0;
  private readonly off: () => void;

  constructor(private readonly deps: WindowDeps) {
    this.fixed = arrangeActions(deps);
    this.off = deps.onChange?.(() => void this.refresh()) ?? (() => {});
  }

  actions = (): readonly ActionDef[] => [...this.open, ...this.fixed];

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async refresh(): Promise<void> {
    const serial = ++this.serial;
    const windows = await this.deps.windows();
    // A later read won while this one waited.
    if (serial !== this.serial) return;
    this.open = windows.filter((window) => window.appId !== SHELL_APP_ID).map((window) => windowAction(window, this.deps));
    for (const listener of this.listeners) listener();
  }

  close(): void {
    this.off();
  }
}
