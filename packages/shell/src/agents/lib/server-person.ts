/** The person's own tool calls (the launcher, a key, a link): the code an agent's call runs, named "You", seeing what the person sees. */

import type { BrowserBridge } from "../../browser/bridge.ts";
import type { Compositor } from "../../compositor/index.ts";
import type { Arrange, Tile } from "../../layout.ts";
import type { AloneStatus } from "../alone/index.ts";
import type { Question } from "../confirm.ts";
import { type ToolResult, toolError } from "../context.ts";
import { type Desktop, Elsewhere, type Hands, type WorkPlaces } from "../desktop/index.ts";
import { LOCKED, type LockWatch } from "../lock.ts";
import type { AgentMask } from "../mask.ts";
import type { AgentUi } from "../presence.ts";
import { type SecretsShared, SessionSecrets } from "../secrets/index.ts";
import type { Call } from "../tools/index.ts";
import { runCall } from "./run/run.ts";

/** How long after a plan's last step the Desktop it worked on is still its own. */
const PLAN_SPACE_MS = 30_000;

export interface PersonParts {
  compositor: Compositor;
  ui: AgentUi;
  desktop: Desktop;
  hands: Hands;
  places: WorkPlaces;
  mask: AgentMask;
  secrets: SecretsShared;
  lock: LockWatch;
  browser: BrowserBridge;
  tile(window: number, to: Arrange): Promise<void>;
  arrangement(window: number): Tile | null;
  /** Whether agents work alone now (alone/). */
  alone(): AloneStatus;
}

export function personRunner(parts: PersonParts): (call: Call, confirm: (question: Question) => Promise<boolean>) => Promise<ToolResult> {
  const { compositor, ui, desktop, hands, mask, lock, browser, tile, arrangement } = parts;
  // The person's calls: never confined (no sign-in for them), named "You" where a sheet would name an agent.
  const personSecrets = new SessionSecrets(parts.secrets, ui, false);
  // A plan the person approved may work on another Desktop (work_in_space, then what it opens): its
  // steps run one after another here, so the Space holds for them and is let go a little after the
  // last, when nothing more of the plan can come. The person's own commands then open where they are.
  const elsewhere = new Elsewhere(parts.places);
  let letGo: ReturnType<typeof setTimeout> | undefined;
  const hold = () => {
    clearTimeout(letGo);
    if (elsewhere.space !== null) letGo = setTimeout(() => void elsewhere.leave(), PLAN_SPACE_MS);
  };
  const you = () => ({ name: "You", detail: "", claims: null, remote: false });
  return async (call, confirm) => {
    if (lock.isLocked) return toolError(LOCKED);
    const signal = new AbortController().signal;
    clearTimeout(letGo);
    return runCall(call, {
      compositor,
      ui,
      desktop,
      hands,
      elsewhere,
      mask,
      secrets: personSecrets.run(0, you, signal),
      agent: "You",
      status: () => {},
      tile,
      arrangement,
      mayName: () => true,
      // The person's own calls use any site, in the tab in front.
      browser: { link: () => browser.current(), whenConnected: (ms) => browser.whenConnected(ms), allowSite: async () => true, mayUse: () => true, tab: null },
      alone: parts.alone,
      confirm,
      // A person has no one to ask but themselves.
      question: async () => ({ none: "no-answer" }),
      signal,
    }).finally(hold);
  };
}
