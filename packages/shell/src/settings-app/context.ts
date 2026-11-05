import type { Grants } from "../agents/consent.ts";
import type { Passwords } from "../agents/secrets/passwords.ts";
import type { FlagsStore } from "../control-center/flags.ts";
import type { RegionStore } from "../region/store.ts";
import type { PhotoChooser } from "../wallpaper/chooser.ts";
import type { AboutInfo } from "./about.ts";
import type { XkbLayouts } from "./layouts.ts";
import type { ScreensStore } from "./screens.ts";
import type { PaneServices } from "./services.ts";
import type { SettingsStore } from "./store.ts";

/** What the panes read and change; the shell hands these in once (start.tsx). */
export interface PaneContext {
  /** settings.json. */
  settings: SettingsStore;
  /** Dark Mode and Do Not Disturb (Control Center's switches). */
  flags: FlagsStore;
  screens: ScreensStore;
  /** The system time zone, clock sync, and language (timedated and localed). */
  region: RegionStore;
  /** The agents' kept answers; revoking one also cuts it off in a live session. */
  grants: Pick<Grants, "entries" | "remove" | "onChange">;
  /** Dashi's vault and the login sources (Settings › Passwords). */
  passwords?: Passwords;
  /** The keyboard layouts xkb knows. */
  layouts: XkbLayouts;
  /** The desktop's file chooser for "Add Photo…" (Wallpaper). */
  chooser: PhotoChooser;
  /** Wi-Fi, Bluetooth, sound, power, and accounts: the machine panes (services.ts). */
  services: PaneServices;
  about(): AboutInfo;
  /** Locks the screen. */
  lock(): void;
  /** Opens the Setup Assistant again. */
  openSetup(): void;
  home: string;
}
