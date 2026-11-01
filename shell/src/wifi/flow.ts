/** What picking a network in the list does. */

import { needsPassword } from "./networks.ts";
import type { WifiStore } from "./store.ts";
import type { WifiNetwork } from "./types.ts";

/**
 * Open and known networks are joined at once. A secured one that is not known
 * asks for its password first. A known one whose saved password no longer
 * works asks too, with the sheet showing that it was refused.
 */
export async function chooseNetwork(store: WifiStore, network: WifiNetwork, askPassword: (network: WifiNetwork) => void): Promise<void> {
  if (!network.known && needsPassword(network.security)) return askPassword(network);
  const result = await store.join(network);
  if (!result.ok && result.reason === "wrong-password") askPassword(network);
}
