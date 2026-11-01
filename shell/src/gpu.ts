/**
 * Which GPU the display runs on. A laptop with two GPUs (an AMD or Intel
 * one that drives the built-in panel, an NVIDIA one for games) lists them
 * in PCI order, and the compositor's fallback (the firmware's boot display,
 * else the first card) can land on the GPU with no screen: on a ROG
 * Zephyrus G14 the NVIDIA card comes first and the AMD one, which drives
 * the panel, does not even say it is the boot display, so dashi-comp found
 * "no connected screen" and the boot splash stayed up.
 *
 * So the card that drives a connected built-in panel wins, then any card
 * with a connected screen, then the boot display, then the first card.
 * dashi-session asks before it starts the compositor (DASHI_DRM_DEVICE),
 * and so does the login screen's Weston (session/dashi-greeter-compositor),
 * through bin/dashi-gpu.ts.
 */

import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { basename, join } from "node:path";

export interface Connector {
  /** As the kernel names it: eDP-1, HDMI-A-1, DP-3. */
  name: string;
  connected: boolean;
}

export interface Card {
  /** card0, card1. */
  name: string;
  devnode: string;
  /** The kernel driver: amdgpu, i915, xe, nvidia, nouveau, simpledrm. */
  driver: string | null;
  /** The firmware showed its boot screen on this card. */
  bootVga: boolean;
  connectors: Connector[];
}

export interface Choice {
  card: Card;
  why: string;
}

/** Built-in panels: a laptop's screen. */
const INTERNAL = /^(eDP|LVDS|DSI)-/;

function rank(card: Card): [number, string] {
  const lit = card.connectors.filter((connector) => connector.connected);
  const panel = lit.find((connector) => INTERNAL.test(connector.name));
  if (panel) return [3, `it drives the built-in panel (${panel.name})`];
  if (lit.length > 0) return [2, `it drives a connected screen (${lit.map((c) => c.name).join(", ")})`];
  if (card.bootVga) return [1, "the firmware showed its boot screen on it, and no card has a connected screen"];
  return [0, "it is the first card, and no card has a connected screen"];
}

/** The card to run the display on, and why; null with no cards. Ties go to the lower card number. */
export function chooseGpu(cards: readonly Card[]): Choice | null {
  const ordered = [...cards].sort((a, b) => cardNumber(a.name) - cardNumber(b.name));
  let best: Choice | null = null;
  let bestRank = -1;
  for (const card of ordered) {
    const [score, why] = rank(card);
    if (score > bestRank) {
      best = { card, why };
      bestRank = score;
    }
  }
  return best;
}

function cardNumber(name: string): number {
  return Number(name.slice("card".length));
}

/** The GPUs the kernel lists under `root` (/sys/class/drm). */
export function readCards(root = "/sys/class/drm", devRoot = "/dev/dri"): Card[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return [];
  }
  return entries
    .filter((entry) => /^card\d+$/.test(entry))
    .map((name) => ({
      name,
      devnode: join(devRoot, name),
      driver: link(join(root, name, "device", "driver")),
      bootVga: text(join(root, name, "device", "boot_vga")) === "1",
      connectors: entries
        .filter((entry) => entry.startsWith(`${name}-`))
        .map((entry) => ({
          name: entry.slice(name.length + 1),
          connected: text(join(root, entry, "status")) === "connected",
        })),
    }));
}

function text(path: string): string | null {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

function link(path: string): string | null {
  try {
    return basename(readlinkSync(path));
  } catch {
    return null;
  }
}
