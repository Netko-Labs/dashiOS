/** The person's own tool calls (the launcher, a key, a link): the code an agent's call runs, named "You", seeing what the person sees. */

import type { BrowserBridge } from "../browser/bridge.ts";
import type { Compositor } from "../compositor.ts";
import type { Arrange, Tile } from "../layout.ts";
import type { Question } from "./confirm.ts";
import { type ToolResult, toolError } from "./context.ts";
import type { Hands } from "./desktop/hands.ts";
import type { Desktop } from "./desktop/index.ts";
import { LOCKED, type LockWatch } from "./lock.ts";
import type { AgentMask } from "./mask.ts";
import type { AgentUi } from "./presence.ts";
import { runCall } from "./run.ts";
import { type SecretsShared, SessionSecrets } from "./secrets/session-secrets.ts";
import type { Call } from "./tools/index.ts";

export interface PersonParts {
  compositor: Compositor;
  ui: AgentUi;
  desktop: Desktop;
  hands: Hands;
  mask: AgentMask;
  secrets: SecretsShared;
  lock: LockWatch;
  browser: BrowserBridge;
  tile(window: number, to: Arrange): Promise<void>;
  arrangement(window: number): Tile | null;
}

export function personRunner(parts: PersonParts): (call: Call, confirm: (question: Question) => Promise<boolean>) => Promise<ToolResult> {
  const { compositor, ui, desktop, hands, mask, lock, browser, tile, arrangement } = parts;
  // The person's calls: never confined (no sign-in for them), named "You" where a sheet would name an agent.
  const personSecrets = new SessionSecrets(parts.secrets, ui, false);
  const you = () => ({ name: "You", detail: "", claims: null, remote: false });
  return async (call, confirm) => {
    if (lock.isLocked) return toolError(LOCKED);
    const signal = new AbortController().signal;
    return runCall(call, {
      compositor,
      ui,
      desktop,
      hands,
      mask,
      secrets: personSecrets.run(0, you, signal),
      agent: "You",
      status: () => {},
      tile,
      arrangement,
      mayName: () => true,
      // The person's own calls use any site, in the tab in front.
      browser: { link: () => browser.current(), whenConnected: (ms) => browser.whenConnected(ms), allowSite: async () => true, mayUse: () => true, tab: null },
      confirm,
      signal,
    });
  };
}
