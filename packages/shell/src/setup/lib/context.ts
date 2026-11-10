import type { AnswerStatus } from "../../agents/index.ts";
import type { RegionStore } from "../../region/index.ts";
import type { XkbLayouts } from "../../settings-app/layouts.ts";
import type { SettingsStore } from "../../settings-app/store.ts";
import type { FlagsStore } from "../../shared/control-center/flags.ts";
import type { WifiNetwork, WifiStore } from "../../wifi/index.ts";
import type { Flow } from "../flow.ts";
import type { ExtrasStore } from "./extras/store.ts";

/** What the assistant's pages read and change: the same stores System Settings uses, so a choice made here is the one Settings shows. */
export interface SetupContext {
  settings: SettingsStore;
  region: RegionStore;
  flags: FlagsStore;
  wifi: WifiStore;
  layouts: XkbLayouts;
  flow: Flow;
  /** The optional software (Extras and Installing pages); its run outlives the window. */
  extras: ExtrasStore;
  /** Ask for a network's password on the shell's own sheet (never a field in this window). */
  askPassword(network: WifiNetwork): void;
  /** Close the window, remembering that the person finished or skipped. */
  finish(outcome: "finished" | "skipped"): void;
  /** Open the launcher (the Done page's Try it); absent where there is none to open. */
  openLauncher?(): void;
  /** Who can answer the launcher (the Agents page lists the harnesses installed); absent without a session. */
  answers?: AnswerStatus;
}
