/** What running a tool needs, and the shape of what it answers. */

import type { Compositor } from "../compositor.ts";
import type { Tile } from "../layout.ts";
import type { Atspi } from "./atspi/client.ts";
import type { Question } from "./confirm.ts";
import type { Hands } from "./desktop/hands.ts";
import type { Desktop } from "./desktop/types.ts";
import type { AgentMask } from "./mask.ts";
import type { AgentUi } from "./presence.ts";
import type { Approval, SheetLogin, SignInAnswer } from "./secrets/broker.ts";
import type { LoginSource } from "./secrets/sources.ts";

/** What the secrets tools need from the connection (desktop/secrets.ts). */
export interface SecretsRun {
  /** Whether the agent runs in Dashi's sandbox (or on another machine): sign-in is only for those. */
  confined: boolean;
  /** This connection's approvals of logins, by login key ("Allow for This Task", "Allow Once"). */
  approvals: Map<string, Approval>;
  /** The enabled login sources, in order. */
  sources(): readonly LoginSource[];
  /** The accessibility bus (null where there is none). */
  atspi(): Promise<Pick<Atspi, "appFor" | "focusedIn"> | null>;
  /** Ask the person which login, on the sheet. */
  ask(summary: string, logins: readonly SheetLogin[]): Promise<SignInAnswer>;
  /** Give the window to the person until they press Done (true), pausing this agent. */
  handOver(window: number, reason: string): Promise<boolean>;
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
  /** What the agent's cursor is called on screen: its process name. */
  agent: string;
  /** What the menu bar says the agent is doing. Nothing the agent could not read itself goes in it. */
  status(text: string): void;
  /** Snap a window into a tile (arrange.ts). */
  tile(window: number, tile: Tile): Promise<void>;
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
}
