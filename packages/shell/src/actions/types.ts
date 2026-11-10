/**
 * An action: one thing the desktop can do, written once and read by
 * everyone (docs/actions.md). The launcher lists it, agents get it as an MCP
 * tool (when `tool` names one), the keymap binds to its address, and a
 * `dashi://` link opens it. It grew out of the agents' ToolDef
 * (agents/tools/define.ts): the same JSON Schema arguments, the same scope,
 * the same `readOnly`/`destructive`, and a `check` that parses arguments
 * live, so a row can say "`value` must be a number from 0.25 to 4" while
 * the person types.
 */

import type { Scope } from "../agents/consent.ts";
import type { ToolResult } from "../agents/context.ts";
import type { Call, ToolName } from "../agents/tools/types.ts";

/** What choosing it is like: open a place, flip a switch, do something, or choose one of several values. */
export type ActionKind = "open" | "toggle" | "run" | "pick";
export const ACTION_KINDS: readonly ActionKind[] = ["open", "toggle", "run", "pick"];

/** Who may use it: the person (the launcher, a key, a link), agents (MCP), or both. */
export type ActionWho = "person" | "agents" | "both";

/** Words it is found by, per language ("en" always; "de", "pt-BR"… from a desktop entry's `Keywords[de]`). */
export type Keywords = Readonly<Record<string, readonly string[]>>;

/** An action's arguments, as untrusted as anything typed or linked. */
export type Args = Record<string, unknown>;

/** What a toggle or a pick is now: shown on its row. */
export type ActionState = boolean | string | number | null;

/**
 * How it went: a line to show (or copy), or why not. A command from outside
 * Dashi (an applet's, a script's) may ask the launcher to keep going: `show`
 * (launcher/lib/extensions.ts): its answer as a row, rows to pick from, or a view
 * it draws itself. Anyone else reads `text`.
 */
export type Outcome = { ok: true; text: string; show?: Shown } | { ok: false; error: string };

/** One row a pick command offers (an applet's `items`, drawn by the shell). */
export interface PickRow {
  id: string;
  title: string;
  detail?: string;
}

/** What a command asks the launcher to show after it ran. */
export type Shown =
  /** Its answer, as the top row: Return copies it. */
  | { kind: "text"; text: string }
  /** Rows for what is typed, asked again on each keystroke (against the 80 ms budget); the one chosen runs. */
  | { kind: "pick"; title: string; ask(query: string): Promise<readonly PickRow[]>; choose(row: PickRow): Promise<Outcome> }
  /** The command draws its answer itself where the rows were, `height` points tall; `place` says where, `close` takes it away. */
  | { kind: "view"; title: string; height: number; place(frame: ViewFrame): void; close(): void; onClose(listener: () => void): void };

/** Where a view goes: the launcher's list area, in its screen's own points. */
export interface ViewFrame {
  /** From the launcher surface's top-left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What carrying an action out can reach. */
export interface ActionContext {
  /** The window that had the keyboard when the person asked (a key's binding): what "the focused window" means. */
  window: number | null;
  /** Carry out an agent tool's call as the person (agents/server.ts `runAsPerson`); absent without a compositor. */
  tool?(call: Call): Promise<ToolResult>;
}

/** Arguments checked: ready to run, or what is wrong with them, in words for the row. */
export type Checked = { ok: true; run(ctx: ActionContext): Promise<Outcome> } | { ok: false; error: string };

export interface ActionDef {
  /** `dashi://…` without arguments; unique in the registry (address.ts). */
  address: string;
  /** Sentence case, as a row shows it ("Turn Dark Mode on or off", "Notes › File › New Note"). */
  title: string;
  /** A sentence for agents and the action list; may be empty. */
  description: string;
  keywords: Keywords;
  kind: ActionKind;
  /** The arguments, JSON Schema properties (as MCP's inputSchema). */
  properties: Record<string, unknown>;
  required?: readonly string[];
  /** What an agent must have been allowed (agents/consent.ts); null: no agent can call it. */
  scope: Scope | null;
  readOnly: boolean;
  /** It can lose work or can't be taken back: a link only opens it, never runs it (links.ts). */
  destructive: boolean;
  /** Neither destructive nor an agent's tool, but a link still only opens it: running it hands a program something private (a picture of the screen). */
  linkOpens?: true;
  idempotent?: boolean;
  /** It asks on a sheet every time, the person included (force quitting, moving to the Trash). */
  asksEveryTime?: true;
  who: ActionWho;
  /** Which source added it ("tools", "apps", "windows", "settings", "dashi", "menus", "applets", "scripts"). */
  source: string;
  /**
   * Who outside Dashi supplied it, as its row says ("Weather", "Your scripts"):
   * an applet, a script, a search provider. Such a row never outranks an
   * exact app or setting match, never wears Dashi's glyphs, and never takes
   * a first-party name (launcher/lib/items.ts).
   */
  from?: string;
  /** The MCP tool it is for agents; only these are in `tools/list`. */
  tool?: ToolName;
  /** Its key, in Dashi's notation ("⇧❖N"), shown on the row so choosing it teaches the key. */
  shortcut?: string;
  /** A full-color icon path or a glyph name (apps.ts iconPath), if it has one. */
  icon?: string;
  /** Where it lives in System Settings, for a settings address: open the pane there and light up the row. */
  place?: { pane: string; row?: string };
  /** What a toggle or pick is now. */
  state?(): ActionState;
  /** Check `args` (only names in `properties`; values untrusted). */
  check(args: Args): Checked;
}

/** A source of actions that can come and go: the apps installed, the windows open, the menus apps publish. */
export interface ActionSource {
  readonly id: string;
  actions(): readonly ActionDef[];
  /** Hear that `actions()` changed; returns what stops listening. */
  subscribe?(listener: () => void): () => void;
  /** Read again now (the launcher opening); a source that is always current has none. */
  refresh?(): Promise<void>;
}

export const ok = (text: string): Outcome => ({ ok: true, text });
export const failed = (error: string): Outcome => ({ ok: false, error });
export const invalid = (error: string): Checked => ({ ok: false, error });
export const ready = (run: (ctx: ActionContext) => Promise<Outcome>): Checked => ({ ok: true, run });
