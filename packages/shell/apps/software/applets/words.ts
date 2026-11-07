/** The applets in words: their categories (and the tile each wears, shared with Flathub's), and the chip a row shows. Pure. */

import type { Category } from "@dashi/applet";
import { TINTS } from "@dashi/ui";
import type { AppletStatus } from "../../../src/applet-store/installer.ts";
import { CATEGORY_GLYPHS, CATEGORY_TINTS, DISCOVER } from "../glyphs.ts";
import type { Chip, Operation } from "../model.ts";

export const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  hardware: "Hardware",
  productivity: "Productivity",
  network: "Network",
  status: "Status",
  media: "Media",
  developer: "Developer",
  utilities: "Utilities",
};

/** Each applet category's nearest Flathub one, whose glyph and tint its tile wears, so one category looks the same across the store. */
const NEAREST: Readonly<Record<Category, string>> = {
  hardware: "System",
  productivity: "Office",
  network: "Network",
  status: "Science",
  media: "AudioVideo",
  developer: "Development",
  utilities: "Utility",
};

export const tileOf = (id: Category): { glyph: string; tint: string } => {
  const nearest = NEAREST[id];
  return { glyph: CATEGORY_GLYPHS[nearest] ?? DISCOVER, tint: CATEGORY_TINTS[nearest] ?? TINTS.goma };
};

/** An applet's chip: Get, Update (with "…" when the consent sheet comes first), Installed in plain words, or why it can't be had. */
export function appletChip(status: AppletStatus, operation: Operation | undefined, asks: boolean): Chip {
  if (operation) return { kind: "busy", operation };
  switch (status.kind) {
    case "get":
      return status.version ? { kind: "get", asks } : { kind: "unavailable", detail: "Needs a newer Dashi" };
    case "update":
      return { kind: "update", asks };
    case "pulled":
      return status.good ? { kind: "update", asks } : { kind: "unavailable", detail: "Turned off" };
    case "installed":
      return { kind: "installed" };
  }
}
