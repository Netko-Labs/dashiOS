/** Copy Address: an action's `dashi://` address, with its arguments filled in, on the clipboard. */

import { type Clipboard, systemClipboard } from "../../shared/clipboard/clipboard.ts";
import { withArgs } from "../address.ts";
import type { ActionDef, Args } from "../types.ts";

/** The text Copy Address puts on the clipboard. */
export const addressText = (action: Pick<ActionDef, "address">, args: Args = {}): string => withArgs(action.address, args);

/** Copies it; false when nothing could write the clipboard (no wl-copy). */
export function copyAddress(action: Pick<ActionDef, "address">, args: Args = {}, clipboard: Clipboard = systemClipboard()): Promise<boolean> {
  return clipboard.writeText(addressText(action, args));
}
