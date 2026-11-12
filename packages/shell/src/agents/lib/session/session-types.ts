/** What a connection is given and what it gives back: its context, a launcher run's policy and hooks, and the socket. */

import type { BrowserBridge } from "../../../browser/bridge.ts";
import type { Compositor } from "../../../compositor/index.ts";
import type { Arrange, Tile } from "../../../layout.ts";
import type { Undo } from "../../ask/index.ts";
import type { Grants, Scope } from "../../consent.ts";
import type { Desktop, Hands } from "../../desktop/index.ts";
import type { AgentMask } from "../../mask.ts";
import type { AgentUi } from "../../presence.ts";
import type { SecretsShared } from "../../secrets/index.ts";
import type { SiteGrants } from "../../sites.ts";
import type { Call } from "../../tools/index.ts";

export interface SessionContext {
  compositor: Compositor;
  ui: AgentUi;
  desktop: Desktop;
  /** What agents' pictures blank, shared by every connection. */
  mask: AgentMask;
  /** The agent seat, shared by every connection. */
  hands: Hands;
  grants: Grants;
  /** Whether the screen is locked: agents are refused and nobody is asked then. */
  lock: { readonly isLocked: boolean };
  /** The menu bar's list changed. */
  publish(): void;
  tile(window: number, to: Arrange): Promise<void>;
  arrangement(window: number): Tile | null;
  /** Login sources, the accessibility bus, and the windows handed to the person. */
  secrets: SecretsShared;
  /** Dashi's browser extension, when a browser has it (browser/bridge.ts). */
  browser: BrowserBridge;
  /** The websites agents may always use (sites.ts). */
  sites: SiteGrants;
  /** An agent started from the launcher: Undo for its settings changes (agents/handoff/service.ts). */
  tasks?: TaskHooks;
}

/** What a run started from the launcher may do on its connection (agents/handoff/grants.ts). */
export interface TaskPolicy {
  granted: readonly Scope[];
  refused: readonly Scope[];
  /** The window its context chip named: it may hand that one to the person, whatever "Manage windows and apps" says. */
  window: number | null;
  /** The harness's name ("Codex"): what sheets and the activity call the run, whatever its process is. */
  name: string;
  /** The sites the person allowed for this task (not always): every turn's connection shares them. */
  sites?: Set<string>;
}

/** The launcher's runs' side of a call: what would put it back, and that it went well. */
export interface TaskHooks {
  before(task: string, call: Call): Undo | null;
  after(task: string, undo: Undo | null, ok: boolean): void;
}

/** A launcher run on this connection: its id and policy (agents/handoff/). */
export interface SessionTask {
  id: string;
  policy: TaskPolicy;
}

/** What a Bun socket offers the session. */
export interface Connection {
  write(data: Uint8Array): number;
  /** Closes the socket now; nothing more is read or sent (not the graceful half-close of `end()`). */
  terminate(): void;
}
