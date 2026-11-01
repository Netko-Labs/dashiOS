/**
 * NetworkManager's `nmcli` text, read strictly. `nmcli dev show` gives the
 * Ethernet details (address, router, DNS, MAC) and `nmcli connection show`
 * the VPN profiles NetworkManager already knows. The text is untrusted: a
 * field that is not what it should be is left out, never guessed at.
 */

/** One device of `nmcli -t dev show`, with the fields the Network pane needs. */
export interface NetDevice {
  name: string;
  /** `ethernet`, `wifi`, `loopback`, … as nmcli names the type. */
  type: string;
  /** NMDeviceState: 100 is activated, 30 disconnected, 20 unavailable. */
  state: number;
  mac: string | null;
  /** The name of the connection profile in use; null when there is none. */
  connection: string | null;
  ipv4: string[];
  gateway: string | null;
  dns: string[];
}

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

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6 = /^[0-9a-fA-F:.]{2,45}$/;
const MAC = /^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
const ACTIVATED = 100;

/** `nmcli -t` keeps a literal colon as `\:` and a backslash as `\\`. */
export function unescapeTerse(text: string): string {
  return text.replace(/\\([:\\])/g, "$1");
}

/** A terse line split at the colons that are not escaped. */
export function splitTerse(line: string): string[] {
  const parts: string[] = [];
  let current = "";
  for (let index = 0; index < line.length; index++) {
    const char = line[index] as string;
    if (char === "\\" && index + 1 < line.length) {
      current += line[index + 1];
      index++;
    } else if (char === ":") {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/** The dotted mask for a prefix length (24 → 255.255.255.0); null for anything else. */
export function maskOf(prefix: number): string | null {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const bits = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return [bits >>> 24, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255].join(".");
}

/** `192.168.1.23/24` as its address and mask; null when it is not an IPv4 address with a prefix. */
export function parseCidr(value: string): { address: string; mask: string } | null {
  const [address, prefix, extra] = value.split("/");
  if (address === undefined || prefix === undefined || extra !== undefined || !IPV4.test(address) || !/^\d{1,2}$/.test(prefix)) return null;
  const mask = maskOf(Number(prefix));
  return mask === null ? null : { address, mask };
}

/** The devices of `nmcli -t -f GENERAL.DEVICE,GENERAL.TYPE,GENERAL.STATE,GENERAL.HWADDR,GENERAL.CONNECTION,IP4.ADDRESS,IP4.GATEWAY,IP4.DNS,IP6.DNS dev show`. */
export function parseDevices(text: string): NetDevice[] {
  const devices: NetDevice[] = [];
  let current: Record<string, string[]> = {};
  const flush = () => {
    const name = current["GENERAL.DEVICE"]?.[0];
    if (name) {
      const stateText = current["GENERAL.STATE"]?.[0] ?? "";
      const state = Number(/^\s*(\d+)/.exec(stateText)?.[1] ?? Number.NaN);
      const mac = current["GENERAL.HWADDR"]?.[0] ?? "";
      const connection = current["GENERAL.CONNECTION"]?.[0] ?? "";
      const gateway = current["IP4.GATEWAY"]?.[0] ?? "";
      devices.push({
        name,
        type: current["GENERAL.TYPE"]?.[0] ?? "",
        state: Number.isFinite(state) ? state : 0,
        mac: MAC.test(mac) ? mac.toUpperCase() : null,
        connection: connection === "" || connection === "--" ? null : connection,
        ipv4: current["IP4.ADDRESS"] ?? [],
        gateway: IPV4.test(gateway) ? gateway : null,
        dns: [...(current["IP4.DNS"] ?? []), ...(current["IP6.DNS"] ?? [])].filter((address) => IPV4.test(address) || (address.includes(":") && IPV6.test(address))),
      });
    }
    current = {};
  };
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      flush();
      continue;
    }
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    // `IP4.ADDRESS[1]` and `IP4.ADDRESS[2]` are one field with two values.
    const key = line.slice(0, colon).replace(/\[\d+\]$/, "");
    (current[key] ??= []).push(unescapeTerse(line.slice(colon + 1)).trim());
  }
  flush();
  return devices;
}

/** The Ethernet devices, connected ones first. */
export function ethernetOf(devices: readonly NetDevice[]): EthernetInfo[] {
  return devices
    .filter((device) => device.type === "ethernet")
    .map((device): EthernetInfo => {
      const connected = device.state === ACTIVATED;
      const first = device.ipv4.map(parseCidr).find((cidr) => cidr !== null) ?? null;
      return {
        name: device.name,
        connected,
        connection: connected ? device.connection : null,
        address: connected ? (first?.address ?? null) : null,
        mask: connected ? (first?.mask ?? null) : null,
        router: connected ? device.gateway : null,
        dns: connected ? device.dns : [],
        mac: device.mac,
      };
    })
    .sort((a, b) => Number(b.connected) - Number(a.connected) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export interface VpnConnection {
  uuid: string;
  name: string;
  /** NetworkManager's connection type: `vpn` (a plug-in) or `wireguard`. */
  kind: "vpn" | "wireguard";
  active: boolean;
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const isConnectionUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

/** The VPN profiles of `nmcli -t -f NAME,UUID,TYPE,ACTIVE connection show`, active ones first, then by name. */
export function parseVpns(text: string): VpnConnection[] {
  const vpns: VpnConnection[] = [];
  for (const line of text.split("\n")) {
    const [name, uuid, type, active] = splitTerse(line);
    if (name === undefined || uuid === undefined || !isConnectionUuid(uuid) || (type !== "vpn" && type !== "wireguard") || name.trim() === "") continue;
    vpns.push({ uuid, name: name.trim(), kind: type, active: active === "yes" });
  }
  return vpns.sort((a, b) => Number(b.active) - Number(a.active) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
