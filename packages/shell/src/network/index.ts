export { type EthernetInfo, ethernetOf, isConnectionUuid, maskOf, parseCidr, parseDevices, parseVpns, splitTerse, type VpnConnection } from "./parse.ts";
export { fakeNetInfo, type NetInfo, type NetInfoSource, nmcliNetInfo } from "./source.ts";
export { NETINFO_POLL_MS, type NetInfoState, NetInfoStore, useNetInfo } from "./store.ts";
