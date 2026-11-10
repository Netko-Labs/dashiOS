/**
 * The graphics card of a two-GPU machine, as sysfs describes it: which DRM
 * card it is, its PCI address and the PCIe port above it (where pciehp
 * reports a link going down), its device nodes, the screens plugged into
 * its own ports, and whether it is awake. Reading these never wakes it:
 * they are the PCI core's files, not the driver's.
 */

import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { type Card, chooseGpu, readCards } from "../gpu/index.ts";

/** Kernel drivers of graphics cards (as opposed to a laptop's built-in GPU). */
const DISCRETE_DRIVERS = new Set(["nvidia", "nouveau"]);
/** Built-in panels: never "a screen on the card's ports". */
const INTERNAL = /^(eDP|LVDS|DSI)-/;
const PCI_ADDRESS = /^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/;

export interface GraphicsCard {
  /** card0. */
  name: string;
  driver: string;
  /** 0000:64:00.0 */
  pci: string;
  /** The PCIe port it hangs off (0000:00:03.1), null when it sits on the root bus. */
  port: string | null;
  /** The device nodes an app holds when it uses the card. */
  nodes: string[];
  /** Connected screens on the card's own ports (HDMI-A-1), never the built-in panel. */
  screens: string[];
}

/** A PCI device's address and its port from the resolved sysfs path (`/sys/devices/pci0000:00/0000:00:03.1/0000:64:00.0`). */
export function pciPlace(devicePath: string): { pci: string; port: string | null } | null {
  const pci = basename(devicePath);
  if (!PCI_ADDRESS.test(pci)) return null;
  const parent = basename(dirname(devicePath));
  return { pci, port: PCI_ADDRESS.test(parent) ? parent : null };
}

/** Which of `cards` is the graphics card: an NVIDIA one beside another GPU, else the one the screens are not on. Null with one GPU. */
export function discreteOf(cards: readonly Card[], display: Card | null): Card | null {
  const real = cards.filter((card) => card.driver !== null && card.driver !== "simpledrm");
  if (real.length < 2) return null;
  const nvidia = real.find((card) => card.driver !== null && DISCRETE_DRIVERS.has(card.driver) && card !== display);
  if (nvidia) return nvidia;
  return real.find((card) => card !== display && !card.bootVga) ?? null;
}

/** The card's connected external screens. */
export function screensOn(card: Card): string[] {
  return card.connectors.filter((connector) => connector.connected && !INTERNAL.test(connector.name)).map((connector) => connector.name);
}

export interface CardRoots {
  drm?: string;
  dev?: string;
}

/** The machine's graphics card, or null on a one-GPU machine. */
export function readGraphicsCard(roots: CardRoots = {}, env: Record<string, string | undefined> = process.env): GraphicsCard | null {
  const drm = roots.drm ?? "/sys/class/drm";
  const dev = roots.dev ?? "/dev";
  const cards = readCards(drm, join(dev, "dri"));
  const display = cards.find((card) => card.devnode === env.DASHI_DRM_DEVICE) ?? chooseGpu(cards)?.card ?? null;
  const card = discreteOf(cards, display);
  if (!card?.driver) return null;
  let place: { pci: string; port: string | null } | null = null;
  try {
    place = pciPlace(realpathSync(join(drm, card.name, "device")));
  } catch {
    place = null;
  }
  if (!place) return null;
  const renders = list(join(drm, card.name, "device", "drm")).filter((entry) => /^renderD\d+$/.test(entry));
  const nvidia = card.driver === "nvidia" ? list(dev).filter((entry) => /^nvidia\d+$/.test(entry)) : [];
  return {
    name: card.name,
    driver: card.driver,
    ...place,
    nodes: [card.devnode, ...renders.map((render) => join(dev, "dri", render)), ...nvidia.map((node) => join(dev, node))],
    screens: screensOn(card),
  };
}

/** The card's screens now (they come and go). */
export function readCardScreens(card: GraphicsCard, drm = "/sys/class/drm"): string[] {
  const found = readCards(drm).find((each) => each.name === card.name);
  return found ? screensOn(found) : [];
}

export type CardPower = "active" | "suspended" | "unknown";

/** Whether the card is awake: the PCI core's runtime PM status. */
export function readCardPower(pci: string, root = "/sys/bus/pci/devices"): CardPower {
  try {
    const status = readFileSync(join(root, pci, "power", "runtime_status"), "utf8").trim();
    return status === "active" ? "active" : status === "suspended" ? "suspended" : "unknown";
  } catch {
    return "unknown";
  }
}

function list(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}
