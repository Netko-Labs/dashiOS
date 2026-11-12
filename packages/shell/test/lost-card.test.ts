import { expect, test } from "bun:test";
import type { Card } from "../src/gpu/gpu.ts";
import { discreteOf, pciPlace, screensOn } from "../src/graphics/card.ts";
import { type CardPlace, LostCardWatch, lossIn, parseJournalLine } from "../src/graphics/lost-card.ts";

/** The reference laptop's RTX 5070 Ti and the port above it. */
const G14: CardPlace = { pci: "0000:64:00.0", port: "0000:00:03.1" };

// `journalctl -k -b -1 -o json`, 2026-11-04 (fields trimmed to what the watch reads and a few around them).
const LINK_DOWN_1104 =
  '{"_KERNEL_DEVICE":"+pci:0000:00:03.1","SYSLOG_IDENTIFIER":"kernel","_UDEV_SYSNAME":"0000:00:03.1","_TRANSPORT":"kernel","_KERNEL_SUBSYSTEM":"pci","PRIORITY":"6","MESSAGE":"pcieport 0000:00:03.1: pciehp: Slot(0-2): Link Down","__REALTIME_TIMESTAMP":"1793829580087205"}';
const XID_79_1104 =
  '{"PRIORITY":"4","MESSAGE":"NVRM: Xid (PCI:0000:64:00): 79, pid=12429, name=CPMMListener, GPU has fallen off the bus.","_TRANSPORT":"kernel","SYSLOG_IDENTIFIER":"kernel","__REALTIME_TIMESTAMP":"1793829781299015"}';
const XID_154_1104 =
  '{"PRIORITY":"4","MESSAGE":"NVRM: Xid (PCI:0000:64:00): 154, GPU recovery action changed from 0x0 (None) to 0x1 (PF FLR)","_TRANSPORT":"kernel","SYSLOG_IDENTIFIER":"kernel"}';
// 2026-11-03 23:42 and 2026-11-04 00:00 (the earlier boot), the same pair.
const LINK_DOWN_1103 = '{"_KERNEL_DEVICE":"+pci:0000:00:03.1","MESSAGE":"pcieport 0000:00:03.1: pciehp: Slot(0-2): Link Down","_TRANSPORT":"kernel"}';
const XID_79_1103 = '{"MESSAGE":"NVRM: Xid (PCI:0000:64:00): 79, pid=5964, name=steamwebhelper, GPU has fallen off the bus.","_TRANSPORT":"kernel"}';
// The same boots: another slot's link going and coming back (00:02.2), which is not the card.
const OTHER_SLOT = '{"_KERNEL_DEVICE":"+pci:0000:00:02.2","MESSAGE":"pcieport 0000:00:02.2: pciehp: Slot(0-1): Link Down","_TRANSPORT":"kernel"}';
const OTHER_SLOT_UP = '{"MESSAGE":"pcieport 0000:00:02.2: pciehp: Slot(0-1): Link Up","_TRANSPORT":"kernel"}';
const ANOTHER_GPU_XID = '{"MESSAGE":"NVRM: Xid (PCI:0000:01:00): 79, pid=900, name=Xorg, GPU has fallen off the bus.","_TRANSPORT":"kernel"}';

const line = (text: string) => {
  const parsed = parseJournalLine(text);
  if (!parsed) throw new Error(`not a kernel line: ${text}`);
  return parsed;
};

test("the 2026-11-03 and 2026-11-04 failures match: Link Down on the card's port, then Xid 79 for the card", () => {
  expect(lossIn(line(LINK_DOWN_1104), G14)).toBe("link-down");
  expect(lossIn(line(XID_79_1104), G14)).toBe("xid-79");
  expect(lossIn(line(LINK_DOWN_1103), G14)).toBe("link-down");
  expect(lossIn(line(XID_79_1103), G14)).toBe("xid-79");
});

test("an Xid or a Link Down about something else doesn't", () => {
  expect(lossIn(line(XID_154_1104), G14)).toBeNull();
  expect(lossIn(line(OTHER_SLOT), G14)).toBeNull();
  expect(lossIn(line(OTHER_SLOT_UP), G14)).toBeNull();
  expect(lossIn(line(ANOTHER_GPU_XID), G14)).toBeNull();
  // A card on the root bus has no port to go down.
  expect(lossIn(line(LINK_DOWN_1104), { pci: G14.pci, port: null })).toBeNull();
});

test("journal lines: MESSAGE as text or as bytes; anything else is no line", () => {
  const bytes = [...new TextEncoder().encode("NVRM: Xid (PCI:0000:64:00): 79, pid=1, name=x, GPU has fallen off the bus.")];
  expect(parseJournalLine(JSON.stringify({ MESSAGE: bytes }))?.message.startsWith("NVRM: Xid")).toBe(true);
  expect(parseJournalLine(LINK_DOWN_1104)?.device).toBe("+pci:0000:00:03.1");
  expect(parseJournalLine("-- No entries --")).toBeNull();
  expect(parseJournalLine('{"MESSAGE": 5}')).toBeNull();
  expect(parseJournalLine("[1, 2]")).toBeNull();
});

test("the watch says it once: the first matching line, and nothing after", () => {
  let feed: (line: string) => void = () => {};
  const watch = new LostCardWatch(G14, {
    markerPath: null,
    follow: (onLine) => {
      feed = onLine;
      return () => {};
    },
  });
  const seen: string[] = [];
  watch.onLost((loss) => seen.push(loss));
  watch.start();
  for (const text of [OTHER_SLOT, OTHER_SLOT_UP, LINK_DOWN_1104, XID_79_1104, XID_154_1104]) feed(text);
  expect(seen).toEqual(["link-down"]);
  expect(watch.lost).toBe("link-down");
});

test("the card's place comes from its sysfs path", () => {
  expect(pciPlace("/sys/devices/pci0000:00/0000:00:03.1/0000:64:00.0")).toEqual({ pci: "0000:64:00.0", port: "0000:00:03.1" });
  expect(pciPlace("/sys/devices/pci0000:00/0000:00:02.0")).toEqual({ pci: "0000:00:02.0", port: null });
  expect(pciPlace("/sys/devices/platform/simple-framebuffer.0")).toBeNull();
});

const card = (name: string, driver: string, connectors: Array<[string, boolean]>, bootVga = false): Card => ({
  name,
  devnode: `/dev/dri/${name}`,
  driver,
  bootVga,
  connectors: connectors.map(([connector, connected]) => ({ name: connector, connected })),
});

test("the graphics card: NVIDIA beside the screens' GPU; none on a one-GPU machine", () => {
  const nvidia = card("card0", "nvidia", [
    ["HDMI-A-1", true],
    ["eDP-2", false],
    ["DP-9", false],
  ]);
  const amd = card("card1", "amdgpu", [["eDP-1", true]], true);
  expect(discreteOf([nvidia, amd], amd)?.name).toBe("card0");
  expect(discreteOf([amd], amd)).toBeNull();
  expect(discreteOf([amd, card("card2", "simpledrm", [])], amd)).toBeNull();
  // A screen on the card's own HDMI port counts; its eDP (a MUX's) does not.
  expect(screensOn(nvidia)).toEqual(["HDMI-A-1"]);
});
