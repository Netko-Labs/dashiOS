/**
 * The windows that stay the person's alone (the brief's item 4, D221): an
 * agent's tree may say they are there, never what is in them, and no number
 * reaches into them. The Setup Assistant, System Settings while it shows the
 * vault, a window handed to the person, and Dashi's own sheets (consent,
 * passwords, the portal's pickers).
 */

import { SETUP_APP_ID } from "../../apps.ts";
import type { CompositorWindow } from "../../compositor/index.ts";
import { isVaultWindow } from "../secrets/index.ts";
import type { PersonOnly } from "./types.ts";

/** The shell's own windows (its sheets) and the portal's pickers: the person answers them. */
const PERSONS_APPS = new Set(["dev.dashi.shell", "dev.dashi.portal"]);

export function personOnly(window: CompositorWindow, handedOver: ReadonlySet<number>): PersonOnly | null {
  if (window.appId === SETUP_APP_ID) return "setup";
  if (isVaultWindow(window)) return "vault";
  if (handedOver.has(window.id) || (window.sheetOf !== undefined && handedOver.has(window.sheetOf))) return "handed-over";
  if (PERSONS_APPS.has(window.appId)) return "consent";
  return null;
}
