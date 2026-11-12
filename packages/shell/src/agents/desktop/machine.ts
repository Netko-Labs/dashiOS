/**
 * The machine panes' settings for agents (settings-app/machine-desktop.ts has
 * what is reachable and why). Status lines say what is being done and never a
 * device's or network's name: those come from other people's hardware.
 */

import { PROFILE_LABEL } from "../../system/profiles.ts";
import { json, type RunContext, type ToolResult, text, toolError } from "../context.ts";
import type { Call } from "../tools/index.ts";

export async function getNetwork(ctx: RunContext): Promise<ToolResult> {
  ctx.status("Checking network settings");
  const network = await ctx.desktop.machine.network();
  return json({
    wifi: { available: network.wifi.available, connected_to: network.wifi.current, known_networks: network.wifi.known },
    ethernet: network.ethernet.map((device) => ({ connected: device.connected, ip_address: device.address, router: device.router, dns_servers: device.dns })),
    vpns: network.vpns.map((vpn) => ({ name: vpn.name, connected: vpn.connected, kind: vpn.kind })),
  });
}

export async function listBluetoothDevices(ctx: RunContext): Promise<ToolResult> {
  ctx.status("Looking at Bluetooth devices");
  const bluetooth = await ctx.desktop.machine.bluetooth();
  return json({ available: bluetooth.available, powered: bluetooth.powered, devices: bluetooth.devices });
}

export async function setBluetoothConnection(call: Extract<Call, { name: "set_bluetooth_connection" }>, ctx: RunContext): Promise<ToolResult> {
  ctx.status(call.connected ? "Connecting a Bluetooth device" : "Disconnecting a Bluetooth device");
  const result = await ctx.desktop.machine.setBluetoothConnection(call.device, call.connected);
  if (result.ok) {
    const word = call.connected ? "connected" : "disconnected";
    return text(`“${call.device}” is ${word}${result.changed ? "" : " already"}.`, { device: call.device, connected: call.connected, changed: result.changed });
  }
  switch (result.reason) {
    case "off":
      return toolError("Bluetooth is off or not available here; the person turns it on in Settings or Control Center.");
    case "none":
      return toolError(`No paired device is called “${call.device}”; list_bluetooth_devices shows them. Pairing a new one is the person's to do.`);
    case "many":
      return toolError(`More than one paired device is called “${call.device}”; the person can choose in Settings > Bluetooth.`);
    case "failed":
      return toolError(`Couldn't ${call.connected ? "connect" : "disconnect"} “${call.device}”. It may be off or out of range.`);
  }
}

export async function getSound(ctx: RunContext): Promise<ToolResult> {
  ctx.status("Checking sound settings");
  const sound = await ctx.desktop.machine.sound();
  const volume = (value: typeof sound.outputVolume) => (value === null ? null : { level: Math.round(value.level * 100) / 100, muted: value.muted });
  return json({
    outputs: sound.outputs,
    inputs: sound.inputs,
    output_volume: volume(sound.outputVolume),
    input_volume: volume(sound.inputVolume),
    show_sound_in_menu_bar: sound.showInMenuBar,
    apps: sound.apps,
    recording: sound.recording,
  });
}

export async function setSoundOutput(call: Extract<Call, { name: "set_sound_output" }>, ctx: RunContext): Promise<ToolResult> {
  ctx.status("Changing the sound output");
  const result = await ctx.desktop.machine.setSoundOutput(call.device);
  if (result.ok) return text(`The sound output is “${result.name}”${result.changed ? "" : " already"}.`, { output: result.name, changed: result.changed });
  if (result.reason === "none") return toolError(`No output is called “${call.device}”; get_sound shows them.`);
  if (result.reason === "many") return toolError(`More than one output is called “${call.device}”; the person can choose in Settings > Sound.`);
  return toolError(`Couldn't make “${call.device}” the output.`);
}

export async function setVolume(call: Extract<Call, { name: "set_volume" }>, ctx: RunContext): Promise<ToolResult> {
  const what = call.target === "output" ? "the volume" : "the microphone volume";
  ctx.status(call.level !== undefined ? `Setting ${what}` : `${call.muted ? "Muting" : "Unmuting"} ${call.target === "output" ? "sound" : "the microphone"}`);
  const volume = await ctx.desktop.machine.setVolume(call.target, {
    ...(call.level === undefined ? {} : { level: call.level }),
    ...(call.muted === undefined ? {} : { muted: call.muted }),
  });
  if (volume === null) return toolError(call.target === "output" ? "There is no sound output to set." : "There is no microphone to set.");
  const level = Math.round(volume.level * 100) / 100;
  return text(`The ${call.target} volume is ${level}${volume.muted ? " and muted" : ""}.`, { target: call.target, level, muted: volume.muted });
}

export async function setAppVolume(call: Extract<Call, { name: "set_app_volume" }>, ctx: RunContext): Promise<ToolResult> {
  ctx.status(
    call.level !== undefined ? "Setting an app's volume" : call.muted !== undefined ? `${call.muted ? "Muting" : "Unmuting"} an app` : "Moving an app's sound",
  );
  const result = await ctx.desktop.machine.setAppVolume(call.app, {
    ...(call.level === undefined ? {} : { level: call.level }),
    ...(call.muted === undefined ? {} : { muted: call.muted }),
    ...(call.output === undefined ? {} : { output: call.output }),
  });
  if (result.ok) {
    const { app } = result;
    const where = app.output === "default" ? "the default output" : `“${app.output}”`;
    return text(`“${app.name}” is at ${app.level}${app.muted ? " and muted" : ""}, on ${where}.`, { ...app });
  }
  switch (result.reason) {
    case "unavailable":
      return toolError("App volumes aren't available on this computer.");
    case "none":
      return toolError(`No app called “${call.app}” is playing sound; get_sound lists the apps that are.`);
    case "many":
      return toolError(`More than one app is called “${call.app}”; the person can choose in Settings > Sound.`);
    case "no-output":
      return toolError(`No output is called “${call.output ?? ""}”; get_sound shows them, or use "default".`);
    case "failed":
      return toolError(`Couldn't change “${call.app}”. It may have stopped playing.`);
  }
}

export async function getPower(ctx: RunContext): Promise<ToolResult> {
  ctx.status("Checking battery and power settings");
  const power = await ctx.desktop.machine.power();
  return json({
    battery: power.battery,
    power_mode: power.powerMode
      ? { active: power.powerMode.active, label: power.powerMode.label, available: power.powerMode.available.map((mode) => mode.id) }
      : null,
    display_off_after_minutes: power.displayOffAfterMinutes,
    sleep_after_minutes: power.sleepAfterMinutes,
    lid: power.lid ? { on_battery: power.lid.onBattery, on_power: power.lid.onPower, with_display: power.lid.withDisplay } : null,
    battery_percentage_in_menu_bar: power.percentageInMenuBar,
  });
}

export async function setPowerProfile(call: Extract<Call, { name: "set_power_profile" }>, ctx: RunContext): Promise<ToolResult> {
  ctx.status("Changing the power mode");
  const result = await ctx.desktop.machine.setPowerProfile(call.profile);
  if (result === "unavailable") return toolError(`This computer doesn't offer ${call.profile}; get_power shows the power modes it has.`);
  if (result === "failed") return toolError(`Couldn't switch to ${PROFILE_LABEL[call.profile]}.`);
  return text(`The power mode is ${PROFILE_LABEL[call.profile]}.`, { profile: call.profile });
}

export async function getAccount(ctx: RunContext): Promise<ToolResult> {
  ctx.status("Checking the account");
  const account = await ctx.desktop.machine.account();
  if (account === null) return toolError("The account can't be read on this computer.");
  return json({
    user_name: account.userName,
    full_name: account.fullName,
    administrator: account.administrator,
    automatic_login: account.automaticLogin,
    has_picture: account.hasPicture,
  });
}
