import type { AgentStore, AnswerStatus, Grants, Passwords, SiteGrants } from "../agents/index.ts";
import type { ClipboardHistory } from "../clipboard/history.ts";
import type { PrivacyStore } from "../privacy/store.ts";
import type { RegionStore } from "../region/store.ts";
import type { FlagsStore } from "../shared/control-center/flags.ts";
import type { PaneId } from "../shared/settings/panes.ts";
import type { PhotoChooser } from "../wallpaper/chooser.ts";
import type { AboutInfo } from "./about.ts";
import type { XkbLayouts } from "./layouts.ts";
import type { ControlCenterEditor } from "./panes/control-center.tsx";
import type { ScreensStore } from "./screens.ts";
import type { PaneServices } from "./services.ts";
import type { SettingsStore } from "./store.ts";

/** What the panes read and change; the shell hands these in once (start.tsx). */
/** The person's list of sites agents may use, as Settings edits it. */
export type AheadSites = Pick<SiteGrants, "subscribe" | "ahead" | "allowAhead" | "forgetAhead">;

export interface PaneContext {
  /** settings.json. */
  settings: SettingsStore;
  /** Dark Mode and Do Not Disturb (Control Center's switches). */
  flags: FlagsStore;
  screens: ScreensStore;
  /** The system time zone, clock sync, and language (timedated and localed). */
  region: RegionStore;
  /** The agents' kept answers; revoking one also cuts it off in a live session. */
  grants: Pick<Grants, "entries" | "remove" | "revoke" | "restore" | "onChange">;
  /** The sites agents may use without asking, the person's list (Settings › Agents). */
  sites?: AheadSites;
  /** The apps' permissions the portal keeps (Privacy & Security); absent where the shell runs none. */
  privacy?: Pick<PrivacyStore, "subscribe" | "getSnapshot" | "revoke" | "refresh">;
  /** Dashi's vault and the login sources (Settings › Passwords). */
  passwords?: Passwords;
  /** The launcher's Ask: where Claude's key is, the local models, and the agents' history (Settings › Agents). */
  answers?: AnswerStatus;
  /** The clipboard history, for Settings › Keyboard's Clear History. */
  clipboard?: Pick<ClipboardHistory, "subscribe" | "getSnapshot" | "clear">;
  /** The installed app an app id or program stands for, as the Dock matches it: its name and icon. */
  installedApp?: (id: string) => { name: string; icon: string } | undefined;
  /** The agents connected now (Settings › Agents: "Connected now"). */
  agents?: Pick<AgentStore, "subscribe" | "getSnapshot">;
  /** The keyboard layouts xkb knows. */
  layouts: XkbLayouts;
  /** The desktop's file chooser for "Add Photo…" (Wallpaper). */
  chooser: PhotoChooser;
  /** Control Center's stores and layout, for its editor (Settings › Control Center); null before the menus start. */
  controlCenter?: () => ControlCenterEditor | null;
  /** Wi-Fi, Bluetooth, sound, power, and accounts: the machine panes (services.ts). */
  services: PaneServices;
  about(): AboutInfo;
  /** Locks the screen. */
  lock(): void;
  /** Opens the Setup Assistant again. */
  openSetup(): void;
  /** Go to another pane, scrolled to one of its rows (a row of the registry: `row` is its part after the pane). */
  show(pane: PaneId, row?: string): void;
  home: string;
}
