/** Network and Bluetooth as agents reach them: reads, and connecting a device the person already paired. */

import { type MachineDesktop, pickByName } from "./machine-reading.ts";
import type { PaneServices } from "./services.ts";

export function networkMethods(services: () => PaneServices): Pick<MachineDesktop, "network" | "bluetooth" | "setBluetoothConnection"> {
  return {
    async network() {
      const { wifi, netinfo } = services();
      await Promise.all([wifi.refresh(), netinfo.refresh()]);
      const wifiState = wifi.getSnapshot();
      const info = netinfo.getSnapshot();
      return {
        wifi: { available: wifiState.available === true, current: wifiState.current?.ssid ?? null, known: wifiState.saved.map((saved) => saved.ssid) },
        // The MAC address stays with the person: it is a fingerprint, and nothing an agent does needs it.
        ethernet: info.ethernet.map((device) => ({ connected: device.connected, address: device.address, router: device.router, dns: device.dns })),
        vpns: info.vpns.map((vpn) => ({ name: vpn.name, connected: vpn.active, kind: vpn.kind })),
      };
    },

    async bluetooth() {
      const { bluetooth } = services();
      await bluetooth.refresh();
      const state = bluetooth.getSnapshot();
      return {
        available: state.available === true,
        powered: state.powered,
        devices: state.mine.map((device) => ({ name: device.name, kind: device.kind, connected: device.connected, battery: device.battery })),
      };
    },

    async setBluetoothConnection(name, connected) {
      const { bluetooth } = services();
      await bluetooth.refresh();
      const state = bluetooth.getSnapshot();
      if (state.available !== true || !state.powered) return { ok: false, reason: "off" };
      const found = pickByName(state.mine, name, (device) => device.name);
      if (found.kind !== "one") return { ok: false, reason: found.kind };
      if (found.item.connected === connected) return { ok: true, changed: false };
      const result = await (connected ? bluetooth.connect(found.item) : bluetooth.disconnect(found.item));
      // The page would show why; an agent only needs to know it did not work.
      bluetooth.dismissFailure();
      return result.ok ? { ok: true, changed: true } : { ok: false, reason: "failed" };
    },
  };
}
