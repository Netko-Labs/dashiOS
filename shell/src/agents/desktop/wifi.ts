/**
 * Wi-Fi for agents: the list, and joining a network the person has joined
 * before. Never a password: secrets through agents need a design of their
 * own (docs/agents.html), so a network that needs one is the person's to
 * join from the Wi-Fi menu.
 */

import { joinMessage } from "../../wifi/networks.ts";
import type { WifiNetwork } from "../../wifi/types.ts";
import { json, type RunContext, text, toolError, type ToolResult } from "../context.ts";

/**
 * What an agent may join: a network the person joined before, with the
 * password the system saved. An open network they never used stays theirs
 * to join (an agent could otherwise move them onto a hostile "Free WiFi"),
 * and so does a secured one (it would need a password typed in).
 */
export const agentMayJoin = (network: WifiNetwork): boolean => network.known;

function describe(network: WifiNetwork) {
  return {
    ssid: network.ssid,
    signal: network.signal,
    security: network.security,
    secured: network.secured,
    known: network.known,
    joinable: agentMayJoin(network),
  };
}

/** The list as the menu would show it now: after a scan, or a plain read if the scan never ran. */
async function fresh(ctx: RunContext) {
  const { wifi } = ctx.desktop;
  await wifi.rescan();
  if (wifi.getSnapshot().available === null) await wifi.refresh();
  return wifi.getSnapshot();
}

export async function listWifi(ctx: RunContext): Promise<ToolResult> {
  ctx.status("Looking for Wi-Fi networks");
  const state = await fresh(ctx);
  if (state.available !== true) return json({ available: false, current: null, networks: [] });
  return json({
    available: true,
    current: state.current ? { ...describe(state.current), connected: true } : null,
    networks: state.networks.map(describe),
  });
}

export async function joinWifi(ssid: string, ctx: RunContext): Promise<ToolResult> {
  ctx.status("Joining a Wi-Fi network");
  const { wifi } = ctx.desktop;
  await wifi.refresh();
  const state = wifi.getSnapshot();
  if (state.available !== true) return toolError("Wi-Fi is not available on this computer.");
  // The name is the system's now (cleaned of control characters), not the agent's string.
  const matches = [...(state.current ? [state.current] : []), ...state.networks].filter((network) => network.ssid === ssid);
  if (matches.length === 0) return toolError(`No network called “${ssid}” is in range; list_wifi_networks shows what is.`);
  const [network, ...others] = matches;
  if (!network || others.length > 0) return toolError(`More than one network in range is called “${ssid}”; the person can pick the right one in the Wi-Fi menu.`);
  ctx.status(`Joining “${network.ssid}”`);
  if (state.current?.key === network.key) return text(`Already connected to “${network.ssid}”.`, { ssid: network.ssid, joined: false });
  if (!agentMayJoin(network)) {
    return toolError(
      `“${network.ssid}” is not a network the person has joined before. Agents can't enter Wi-Fi passwords or join new networks; ask them to join it from the Wi-Fi menu.`,
    );
  }
  const result = await wifi.join(network);
  if (result.ok) return text(`Joined “${network.ssid}”.`, { ssid: network.ssid, joined: true });
  // The failure is reported here; it need not wait in the menu for the person.
  wifi.dismissFailure();
  const advice = result.reason === "wrong-password" ? " The saved password no longer works; the person has to enter the new one in the Wi-Fi menu." : "";
  return toolError(`Couldn't join “${network.ssid}”: ${joinMessage(result.reason)}${advice}`);
}
