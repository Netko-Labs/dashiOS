/** What every connection of the agents server shares: the login sources, the accessibility bus, and the mask over what an agent's pictures must not show. */

import type { Compositor } from "../../compositor.ts";
import { Atspi } from "../atspi/index.ts";
import { AgentMask } from "../mask.ts";
import { isVaultWindow, type LoginSource, type SecretsShared, type Vault } from "../secrets/index.ts";

export interface SharedSecrets {
  secrets: SecretsShared;
  mask: AgentMask;
  /** Leave the accessibility bus, if it was joined. */
  close(): void;
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
    filled: () =>
      [...secrets.filled].flatMap(([window, fields]) =>
        fields
          .filter((f) => f.until > Date.now())
          .map((field) => ({
            window,
            rect: field.rect,
            again: field.again,
            forget: () =>
              secrets.filled.set(
                window,
                (secrets.filled.get(window) ?? []).filter((f) => f !== field),
              ),
          })),
      ),
    isVault: isVaultWindow,
  });
  secrets.touched = (window) => mask.prompts.touched(window);
  return { secrets, mask, close: () => atspi?.close() };
}
