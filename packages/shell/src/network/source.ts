/**
 * Where the Network pane's Ethernet and VPN facts come from: `nmcli` on a
 * real session, a stand-in on a development run (it must not bring the host's
 * VPN up or down, and its addresses are not for screenshots). Reading goes
 * through NetworkManager's own tool, so a machine without it simply has
 * nothing to show.
 */

import { type Run } from "../system/exec.ts";
import { type EthernetInfo, ethernetOf, isConnectionUuid, parseDevices, parseVpns, type VpnConnection } from "./parse.ts";

export interface NetInfo {
  ethernet: EthernetInfo[];
  vpns: VpnConnection[];
}

export interface NetInfoSource {
  /** Null when NetworkManager cannot be asked. */
  read(): Promise<NetInfo | null>;
  /** Starts or stops a VPN the person's NetworkManager already has; true when asked successfully. Connecting returns before it finishes. */
  setVpn(uuid: string, up: boolean): Promise<boolean>;
}

const DEVICE_FIELDS = "GENERAL.DEVICE,GENERAL.TYPE,GENERAL.STATE,GENERAL.HWADDR,GENERAL.CONNECTION,IP4.ADDRESS,IP4.GATEWAY,IP4.DNS,IP6.DNS";

export function nmcliNetInfo(run: Run): NetInfoSource {
  return {
    read: async () => {
      const [devices, connections] = await Promise.all([
        run(["nmcli", "-t", "-f", DEVICE_FIELDS, "dev", "show"]),
        run(["nmcli", "-t", "-f", "NAME,UUID,TYPE,ACTIVE", "connection", "show"]),
      ]);
      if (devices === null && connections === null) return null;
      return { ethernet: ethernetOf(parseDevices(devices ?? "")), vpns: parseVpns(connections ?? "") };
    },
    setVpn: async (uuid, up) => {
      if (!isConnectionUuid(uuid)) return false;
      // `--wait 0`: the activation goes on in NetworkManager; the pane watches it arrive.
      return (await run(["nmcli", "--wait", "0", "connection", up ? "up" : "down", "uuid", uuid])) !== null;
    },
  };
}

/** A pretend wired connection and two VPNs, whose switches only move in memory. */
export function fakeNetInfo(): NetInfoSource {
  const vpns = new Map<string, VpnConnection>([
    ["5b1f3a52-1f0e-4b4f-9a3e-0c1d2e3f4a51", { uuid: "5b1f3a52-1f0e-4b4f-9a3e-0c1d2e3f4a51", name: "Work VPN", kind: "vpn", active: false }],
    ["8c2d4b63-2a1f-4c50-8b4f-1d2e3f4a5b62", { uuid: "8c2d4b63-2a1f-4c50-8b4f-1d2e3f4a5b62", name: "Home WireGuard", kind: "wireguard", active: true }],
  ]);
  const ethernet: EthernetInfo = {
    name: "enp3s0",
    connected: true,
    connection: "Wired connection 1",
    address: "192.168.1.23",
    mask: "255.255.255.0",
    router: "192.168.1.1",
    dns: ["192.168.1.1", "9.9.9.9"],
    mac: "52:54:00:AB:CD:EF",
  };
  return {
    read: async () => ({ ethernet: [ethernet], vpns: [...vpns.values()].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)) }),
    setVpn: async (uuid, up) => {
      const vpn = vpns.get(uuid);
      if (!vpn) return false;
      vpns.set(uuid, { ...vpn, active: up });
      return true;
    },
  };
}
