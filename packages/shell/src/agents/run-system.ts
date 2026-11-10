/** The machine's settings and hardware: settings, region, sound, power, account, displays, Bluetooth and Wi-Fi. */

import * as desktop from "./desktop/index.ts";
import type { Handlers } from "./run-types.ts";

export const systemHandlers = {
  get_settings: (_call, ctx) => desktop.getSettings(ctx),
  set_setting: (call, ctx) => desktop.setSetting(call, ctx),
  get_region_settings: (_call, ctx) => desktop.getRegionSettings(ctx),
  set_time_zone: (call, ctx) => desktop.setTimeZone(call, ctx),
  set_clock_24_hour: (call, ctx) => desktop.setClock24Hour(call, ctx),
  set_region_formats: (call, ctx) => desktop.setRegionFormats(call, ctx),
  open_setup_assistant: (call, ctx) => desktop.openSetupAssistant(call, ctx),
  get_network: (_call, ctx) => desktop.getNetwork(ctx),
  list_bluetooth_devices: (_call, ctx) => desktop.listBluetoothDevices(ctx),
  set_bluetooth_connection: (call, ctx) => desktop.setBluetoothConnection(call, ctx),
  get_sound: (_call, ctx) => desktop.getSound(ctx),
  set_sound_output: (call, ctx) => desktop.setSoundOutput(call, ctx),
  set_volume: (call, ctx) => desktop.setVolume(call, ctx),
  set_app_volume: (call, ctx) => desktop.setAppVolume(call, ctx),
  get_power: (_call, ctx) => desktop.getPower(ctx),
  set_power_profile: (call, ctx) => desktop.setPowerProfile(call, ctx),
  get_account: (_call, ctx) => desktop.getAccount(ctx),
  list_displays: (_call, ctx) => desktop.listDisplays(ctx),
  set_display_scale: (call, ctx) => desktop.setDisplayScale(call.display, call.scale, ctx),
  set_display_mode: (call, ctx) =>
    desktop.setDisplayMode(
      call.display,
      { width: call.width, height: call.height, ...(call.refreshMhz !== undefined ? { refreshMhz: call.refreshMhz } : {}) },
      ctx,
    ),
  set_display_rotation: (call, ctx) => desktop.setDisplayRotation(call.display, call.rotation, ctx),
  set_primary_display: (call, ctx) => desktop.setPrimaryDisplay(call.display, ctx),
  arrange_display: (call, ctx) => desktop.arrangeDisplay(call.display, call.x, call.y, ctx),
  list_wifi_networks: (_call, ctx) => desktop.listWifi(ctx),
  join_wifi: (call, ctx) => desktop.joinWifi(call.ssid, ctx),
} satisfies Handlers<
  | "get_settings"
  | "set_setting"
  | "get_region_settings"
  | "set_time_zone"
  | "set_clock_24_hour"
  | "set_region_formats"
  | "open_setup_assistant"
  | "get_network"
  | "list_bluetooth_devices"
  | "set_bluetooth_connection"
  | "get_sound"
  | "set_sound_output"
  | "set_volume"
  | "set_app_volume"
  | "get_power"
  | "set_power_profile"
  | "get_account"
  | "list_displays"
  | "set_display_scale"
  | "set_display_mode"
  | "set_display_rotation"
  | "set_primary_display"
  | "arrange_display"
  | "list_wifi_networks"
  | "join_wifi"
>;
