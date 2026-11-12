/** The network module's public types: a wired connection and a VPN profile, as `nmcli` gives them (lib/parse.ts). */

export interface EthernetInfo {
  name: string;
  /** A cable is in and the profile is active. */
  connected: boolean;
  /** `Wired connection 1`; null when not connected. */
  connection: string | null;
  /** `192.168.1.23`, without the prefix. */
  address: string | null;
  /** The subnet mask, `255.255.255.0`. */
  mask: string | null;
  router: string | null;
  dns: string[];
  mac: string | null;
}

export interface VpnConnection {
  uuid: string;
  name: string;
  /** NetworkManager's connection type: `vpn` (a plug-in) or `wireguard`. */
  kind: "vpn" | "wireguard";
  active: boolean;
}
