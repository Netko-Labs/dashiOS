/**
 * What Settings reads out of the settings file: one interface per section, and
 * `SettingsData`, the whole file as Settings understands it. The file's layout
 * and checks are in sections.ts; the store that reads and writes it is in
 * store.ts.
 */

import type { AnswererChoice, HarnessId } from "../agents/index.ts";
import type { RefreshChoice, VrrMode } from "../display-config/index.ts";
import type { DockSettings } from "../dock/settings.ts";
import type { InputMethodName } from "../input-method.ts";
import type { GraphicsSettings, PowerSection } from "../power/index.ts";
import type { KeyboardSettings, MouseSettings, TouchpadSettings } from "../settings/index.ts";
import type { CornerName } from "../shared/appearance/index.ts";
import type { CatalogSetting } from "../shared/applet-store/index.ts";
import type { DictationSettings, PersonaSettings } from "../shared/pill/index.ts";
import type { ClockSettings, RegionSettings } from "../shared/time/index.ts";
import type { SpaceNames } from "../spaces/types.ts";
import type { VoiceSettings } from "../voice/types.ts";
import type { WallpaperMode } from "../wallpaper/catalog.ts";
import type { FrameRate, LiveShader, WallpaperKind } from "../wallpaper/live/choice.ts";
import type { X11Scaling } from "../xwayland-scale.ts";

export interface IdleSettings {
  /** 0 never blanks the screens. */
  blankAfterSeconds?: number;
  /** 0 (or no key) never puts the computer to sleep by itself. */
  sleepAfterSeconds?: number;
}

/** `inputMethod`: the input method the session runs (input-method.ts); none when not set. */
export interface InputMethodSettings {
  engine?: InputMethodName;
}

/** `menuBar`: what the status area shows beyond its defaults. */
export interface MenuBarSettings {
  /** The battery's percentage beside its glyph; off unless set. */
  batteryPercent?: boolean;
  /** The volume glyph; on unless set. */
  sound?: boolean;
}

export interface AppearanceSettings {
  /** How round windows are (shared/appearance/corners.ts); medium when not set. */
  cornerRadius?: CornerName;
  /** Window animations off (the compositor's; motion/). */
  reduceMotion?: boolean;
  /** A ring in the accent color around the window with the keyboard (appearance/window-style.ts); off when not set. */
  highlightActiveWindow?: boolean;
  /** Dark Mode follows the time of day: dark in the evening and night (appearance/auto.ts). */
  auto?: boolean;
  /** The pointer's size in points (pointer.ts); 24 when not set. */
  pointerSize?: number;
  /** What the shell's type is multiplied by (text-size.ts); 1 when not set. */
  textSize?: number;
  /** How X11 apps meet a scaled screen (xwayland-scale.ts); sharp when not set. */
  x11Apps?: X11Scaling;
}

/** `appearance.wallpaper`: what the desktop shows behind everything, and the photos the person added. */
export interface WallpaperSettings {
  /** A bundled wallpaper's id or an absolute path; none is the default (wallpaper/catalog.ts). */
  path?: string;
  mode?: WallpaperMode;
  /** Photos added in System Settings, most recent first. */
  photos?: string[];
  /** What runs behind the windows; a picture unless set (wallpaper/live/choice.ts). */
  kind?: WallpaperKind;
  shader?: LiveShader;
  /** The video playing, and the videos added in System Settings, most recent first. */
  video?: string;
  videos?: string[];
  fps?: FrameRate;
  /** Live wallpapers stop on battery unless this is false. */
  pauseOnBattery?: boolean;
}

export interface NightShiftSettings {
  /** "HH:MM" the screens turn warm, and the time they turn back; both or neither make a schedule. */
  from?: string;
  to?: string;
  /** How warm, 1900 (candle) to 6500 (daylight). */
  kelvin?: number;
}

/** Spaces (spaces/): how many there are, kept as they change, and whether activating an app's window on another Space goes there. */
export interface SpacesSettings {
  count?: number;
  /** What each Desktop is called; null after its apps (spaces/names.ts). */
  names?: SpaceNames;
  switchOnActivate?: boolean;
  /** A full-screen window gets a Desktop of its own (spaces/fullscreen.ts); on when unset. */
  fullscreenDesktop?: boolean;
}

/** The person's launcher aliases and keys, each naming a `dashi://` address (launcher/person-keys.ts). */
export interface LauncherSettings {
  /** Alias → address ("ff" → dashi://app/org.mozilla.firefox). */
  aliases?: Readonly<Record<string, string>>;
  /** A rule's `when` → address ("super+alt+n" → dashi://app/dev.dashi.notes/menu/new). */
  keys?: Readonly<Record<string, string>>;
}

/** Who answers the launcher's Ask (agents/ask/answerer.ts); unset until the person picks. */
export interface AgentsSettings {
  answerer?: AnswererChoice;
  /** The local model to ask by name; the first one installed when unset. */
  localModel?: string;
  /** The OpenAI model GPT answers with; the most capable chat model the key lists when unset (agents/ask/lib/gpt-models.ts). */
  gptModel?: string;
  /** Who a task from the launcher is handed to first ("Hand it off"; agents/handoff/); the answerer, else the first installed, when unset. */
  handOff?: HarnessId;
  /** "Don't ask for these again": a task starts without its grants card (agents/handoff/grants.ts). */
  skipGrants?: boolean;
}

/** `clipboard`: clipboard history and snippets (clipboard/; Settings › Keyboard). */
export interface ClipboardSettings {
  /** Copies kept for ⌥❖V; on unless set to false. */
  history?: boolean;
  /** The apps whose copies are never kept (app ids or programs); clipboard/left-out.ts DEFAULT_LEFT_OUT unless set. */
  leftOut?: readonly string[];
  /** Snippets expand in terminals too; off unless set. */
  snippetsInTerminals?: boolean;
}

/** `applets`: the applet catalogs the person added beside Dashi's (shared/applet-store/catalogs.ts; Software › Menu bar applets › Catalogs…). */
export interface AppletsSettings {
  catalogs?: readonly CatalogSetting[];
}

/** `screenSharing`: programs trusted to capture the screen directly, by absolute path (screen-capture.ts; Settings › Privacy & Security). */
export interface ScreenSharingSettings {
  clients?: readonly string[];
}

export interface DisplaySettings {
  /** The scale the person chose; it wins over the one picked from the pixel density. */
  scale?: number;
  /** Variable refresh rate as the person chose it (off when unset). */
  vrr?: VrrMode;
  /**
   * "fixed": the person picked a rate, so Automatic leaves it (display-config/refresh-policy.ts).
   * Unset is Automatic, the default, also for a file from before there was a choice.
   */
  refresh?: RefreshChoice;
}

/** The file as Settings understands it; anything else in the file is kept but not read. */
export interface SettingsData {
  touchpad: TouchpadSettings;
  mouse: MouseSettings;
  keyboard: KeyboardSettings;
  idle: IdleSettings;
  menuBar: MenuBarSettings;
  inputMethod: InputMethodSettings;
  appearance: AppearanceSettings;
  wallpaper: WallpaperSettings;
  nightShift: NightShiftSettings;
  clock: ClockSettings;
  region: RegionSettings;
  /** The keys the file holds; dock/settings.ts `resolveDock` fills in the rest. */
  dock: Partial<DockSettings>;
  displays: Readonly<Record<string, DisplaySettings>>;
  spaces: SpacesSettings;
  /** Power modes, the charge limit, the processor (power/modes/settings.ts). */
  power: PowerSection;
  /** The graphics card's mode (graphics/). */
  graphics: GraphicsSettings;
  /** The launcher's aliases and keys. */
  launcher: LauncherSettings;
  /** Who answers the launcher's Ask. */
  agents: AgentsSettings;
  /** Clipboard history and snippets. */
  clipboard: ClipboardSettings;
  /** Programs that capture the screen without the portal. */
  screenSharing: ScreenSharingSettings;
  /** The applet catalogs added in Software. */
  applets: AppletsSettings;
  /** Talking to Dashi: whether it is on, its key and its voice (voice/; Settings › Voice). */
  voice: VoiceSettings;
  /** Dictation: whether it is on, its key, hands-free and tidying (shared/pill/dictation.ts; Settings › Voice). */
  dictation: DictationSettings;
  /** Who Dashi is: its name, character, colour, mark and how much it talks (shared/pill/persona.ts; Settings › Dashi). */
  persona: PersonaSettings;
}
