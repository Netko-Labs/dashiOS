/** What a tool call comes to once its arguments are checked. */

import type { Arrange } from "../../layout.ts";
import type { PageId } from "../../setup/flow.ts";
import type { ProfileId } from "../../system/profiles.ts";
import type { Chord } from "./keys.ts";

/** A rectangle in whole points of the global screen space (what `capture` takes). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A point in a window's content, in logical pixels from its top left. */
export interface Point {
  x: number;
  y: number;
}

export type Button = "left" | "right" | "middle";

export type Call =
  | { name: "list_windows" }
  | { name: "list_apps" }
  | { name: "screenshot"; window: number | null; rect?: Rect }
  | { name: "record_screen"; seconds: number; display: string | null; rect?: Rect; frames: number }
  | { name: "launch_app"; app: string }
  | { name: "open_in_preview"; path: string }
  | { name: "focus_window" | "minimize_window" | "close_window"; window: number }
  | { name: "tile_window"; window: number; tile: Arrange }
  | { name: "force_quit_app"; target: { window: number } | { pid: number } }
  | { name: "lock_screen" }
  | { name: "list_spaces" }
  | { name: "switch_space"; space: number }
  | { name: "move_window_to_space"; window: number; space: number }
  | { name: "list_notifications"; limit: number }
  | { name: "dismiss_notification"; id: number }
  | { name: "clear_notifications" }
  | { name: "get_settings" }
  /** A row of System Settings agents may change, by its registry name (settings-app/registry/), with a value its schema took. */
  | { name: "set_setting"; setting: string; value: boolean | string | number }
  | { name: "get_network" }
  | { name: "list_bluetooth_devices" }
  | { name: "set_bluetooth_connection"; device: string; connected: boolean }
  | { name: "get_sound" }
  | { name: "set_sound_output"; device: string }
  | { name: "set_volume"; target: "output" | "input"; level?: number; muted?: boolean }
  | { name: "get_power" }
  | { name: "set_power_profile"; profile: ProfileId }
  | { name: "get_account" }
  | { name: "get_region_settings" }
  | { name: "set_time_zone"; timeZone: string }
  | { name: "set_clock_24_hour"; value: boolean }
  | { name: "set_region_formats"; locale: string | null }
  | { name: "open_setup_assistant"; page: PageId | null }
  | { name: "list_displays" }
  | { name: "set_display_scale"; display: string; scale: number }
  | { name: "list_folder"; path: string; hidden: boolean; limit: number }
  | { name: "search_files"; query: string; folder: string | null; limit: number }
  | { name: "open_file" | "trash_file"; path: string }
  | { name: "list_notes"; folder: string | null; limit: number }
  | { name: "search_notes"; query: string; limit: number }
  | { name: "read_note"; id: string }
  | { name: "create_note"; title: string; body: string; folder: string }
  | { name: "append_to_note"; id: string; text: string }
  | { name: "list_calendars" }
  | { name: "list_events"; from: string; to: string; calendar: string | null; limit: number }
  | {
      name: "create_event";
      title: string;
      /** A day (all day) or a day and time, "2026-11-05T14:00". */
      start: string;
      end: string | null;
      calendar: string | null;
      location: string;
      notes: string;
      repeat: { freq: "daily" | "weekly" | "monthly" | "yearly"; interval: number; count?: number; until?: string } | null;
      alert: number | null;
    }
  | { name: "set_display_mode"; display: string; width: number; height: number; refreshMhz?: number }
  | { name: "set_display_rotation"; display: string; rotation: 0 | 90 | 180 | 270 }
  | { name: "set_primary_display"; display: string }
  | { name: "arrange_display"; display: string; x: number; y: number }
  | { name: "list_wifi_networks" }
  | { name: "join_wifi"; ssid: string }
  | { name: "search_software"; query: string; limit: number }
  | { name: "get_software"; app: string }
  | { name: "list_installed_software" }
  | { name: "list_software_updates" }
  | { name: "request_software_install"; app: string }
  | { name: "request_software_update"; target: "apps" | "system" | { app: string } }
  | { name: "click"; window: number; x: number; y: number; button: Button; count: number }
  | { name: "scroll"; window: number; x: number; y: number; dx: number; dy: number }
  | { name: "drag"; window: number; from: Point; to: Point }
  | { name: "type_text"; window: number; text: string }
  | { name: "press_keys"; window: number; keys: string; chords: Chord[] }
  | { name: "list_menus"; window: number | null }
  | { name: "choose_menu_item"; window: number; menu: string; item: string }
  | { name: "list_logins"; site: string | null }
  | { name: "sign_in" | "fill_code"; window: number; site: string; account: string | null; submit: boolean }
  | { name: "hand_over"; window: number; reason: string }
  | { name: "pay"; window: number; site: string; cents: number; card: string | null }
  | { name: "read_clipboard_history"; limit: number };

export type ToolName = Call["name"];

/** An unknown tool (a protocol error), or arguments that don't fit (a tool error the agent can read). */
export type CallError = { unknown: string } | { arguments: string };
