/** What every connection of the agents server shares: the login sources, the accessibility bus, and the mask over what an agent's pictures must not show. */

import type { Compositor } from "../../compositor/index.ts";
import { Atspi } from "../atspi/index.ts";
import { AgentMask } from "../mask.ts";
import { isVaultWindow, type LoginSource, type SecretsShared, type Vault } from "../secrets/index.ts";

export interface SharedSecrets {
  secrets: SecretsShared;
  mask: AgentMask;
  /** Leave the accessibility bus, if it was joined. */
  close(): void;
}

/** Forgets the filled fields whose time is up, and a window left with none: the map holds only what is still blanked. */
export function dropExpired<F extends { until: number }>(filled: Map<number, F[]>, now: number): void {
  for (const [window, fields] of filled) {
    const live = fields.filter((field) => field.until > now);
    if (live.length === 0) filled.delete(window);
    else if (live.length !== fields.length) filled.set(window, live);
  }
}

export function sharedSecrets(compositor: Compositor, sources: () => readonly LoginSource[], vault: Pick<Vault, "cards" | "pay">): SharedSecrets {
  // The accessibility bus, joined when a picture first needs it; a failure is tried again next time.
  let atspi: Atspi | null = null;
  const joinAtspi = async () => (atspi ??= await Atspi.connect());
  const secrets: SecretsShared = { sources, atspi: joinAtspi, handedOver: new Set(), filled: new Map(), vault };
  const mask = new AgentMask({
    captureMask: (params) => compositor.captureMask(params),
    windows: () => compositor.windows(),
    atspi: joinAtspi,
    handedOver: () => [...secrets.handedOver],
    filled: () => {
      dropExpired(secrets.filled, Date.now());
      return [...secrets.filled].flatMap(([window, fields]) =>
        fields.map((field) => ({
          window,
          rect: field.rect,
          again: field.again,
          forget: () =>
            secrets.filled.set(
              window,
              (secrets.filled.get(window) ?? []).filter((f) => f !== field),
            ),
        })),
      );
    },
    isVault: isVaultWindow,
  });
  secrets.touched = (window) => mask.prompts.touched(window);
  return { secrets, mask, close: () => atspi?.close() };
}
