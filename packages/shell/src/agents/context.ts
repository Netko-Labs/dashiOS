/** What running a tool needs, and the shape of what it answers. */

import type { BrowserLink } from "../browser/bridge.ts";
import type { Compositor } from "../compositor.ts";
import type { Arrange, Tile } from "../layout.ts";
import type { Atspi, Placed, Rect } from "./atspi/index.ts";
import type { Question } from "./confirm.ts";
import type { Desktop, Hands } from "./desktop/index.ts";
import type { AgentMask } from "./mask.ts";
import type { AgentUi } from "./presence.ts";
import type { Approval, SheetLogin, SignInAnswer } from "./secrets/broker.ts";
import type { LoginSource } from "./secrets/sources.ts";
import type { Vault } from "./secrets/vault.ts";

/** What the secrets tools need from the connection (desktop/secrets.ts). */
export interface SecretsRun {
  /** Whether the agent runs in Dashi's sandbox (or on another machine): sign-in is only for those. */
  confined: boolean;
  /** This connection's approvals of logins, by login key ("Allow for This Task", "Allow Once"). */
  approvals: Map<string, Approval>;
  /** The enabled login sources, in order. */
  sources(): readonly LoginSource[];
  /** The accessibility bus (null where there is none). */
  atspi(): Promise<(Pick<Atspi, "appFor" | "focusedIn"> & Partial<Pick<Atspi, "wake">>) | null>;
  /** Ask the person which login, on the sheet. */
  ask(summary: string, logins: readonly SheetLogin[]): Promise<SignInAnswer>;
  /** A field Dashi typed a secret into (a code, a card): agents' pictures blank it for a while. */
  filled(window: number, rect: Rect | null, again?: Placed["again"]): void;
  /** Dashi's vault, for cards and payments. */
  vault: Pick<Vault, "cards" | "pay">;
  /** Run `work` with this agent's other calls held (Dashi checking a field and typing into it). */
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  /** Give the window to the person until they press Done (true), pausing this agent. */
  handOver(window: number, reason: string): Promise<boolean>;
}

/** What the website tools need from the connection (desktop/browser.ts). */
export interface BrowserRun {
  /** Dashi's extension in the browser, when one is connected. */
  link(): BrowserLink | null;
  /** Until an extension connects (a browser just started), at most `ms`. */
  whenConnected(ms: number): Promise<BrowserLink | null>;
  /** Whether this agent may use `site`: allowed already, or the person says so now (sites.ts). */
  allowSite(site: string): Promise<boolean>;
  /** Whether it may, without asking. */
  mayUse(site: string): boolean;
  /** The tab this agent used last: the website tools' tab when none is named. */
  tab: number | null;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export const toolError = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

export const text = (value: string, structured?: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text: value }],
  ...(structured ? { structuredContent: structured } : {}),
});

/** A list or record as the agent reads it: JSON in the text, and again as structured content. */
export const json = (structured: Record<string, unknown>): ToolResult => text(JSON.stringify(structured), structured);

export interface RunContext {
  compositor: Compositor;
  ui: AgentUi;
  /** The desktop's own stores: notifications, switches, Wi-Fi, Force Quit, the lock screen. */
  desktop: Desktop;
  /** The agent seat: pointer and keyboard input in one window (desktop/hands.ts). */
  hands: Hands;
  /** What its pictures blank (mask.ts): updated before every capture. */
  mask: AgentMask;
  /** Signing in and handing over (desktop/secrets.ts). */
  secrets: SecretsRun;
  /** Websites, through Dashi's browser extension (desktop/browser.ts). */
  browser: BrowserRun;
  /** What the agent's cursor is called on screen: its process name. */
  agent: string;
  /** What the menu bar says the agent is doing. Nothing the agent could not read itself goes in it. */
  status(text: string): void;
  /** Tile, fill, center, or give a window its own frame back (arrange.ts). */
  tile(window: number, to: Arrange): Promise<void>;
  /** How the shell arranged a window (a tile, Fill), or null at its own frame (arrange.ts). */
  arrangement(window: number): Tile | null;
  /**
   * Whether this agent may read window titles and app ids, i.e. holds the
   * "see" scope. Only list_windows is allowed to say what a window is called
   * otherwise; every other result and status line names a window by its id,
   * or an agent with just "act" could read every title by trying ids.
   */
  mayName(): boolean;
  /**
   * Ask the person about this one action, on screen, and wait. True only if
   * they went ahead: a refusal, no answer, the agent leaving, or the screen
   * locking all come back false. The answer is never kept.
   */
  confirm(question: Question): Promise<boolean>;
  /** Aborted when the agent gives up on this call, or leaves: sheets come down, nothing more is typed. */
  signal: AbortSignal;
}
