/** The Store's one catalog on this computer: an app or a command-line tool, and every source that has it. */

import type { Source } from "./sources.ts";

export interface Offer {
  /** The source's id (sources.ts). */
  source: string;
  kind: "flatpak" | "rpm";
  /** A Flatpak app id, or an RPM package name. */
  ref: string;
  /** The dnf repository it comes from (RPM only). */
  repoId: string | null;
  version: string | null;
  /** Flathub's mark: its developer proved who publishes it. */
  verified: boolean;
  installed: boolean;
}

export interface CatalogEntry {
  /** `app:org.gimp.gimp` (lowercased AppStream or desktop id), `tool:ripgrep`. */
  key: string;
  kind: "app" | "tool";
  name: string;
  summary: string;
  developer: string | null;
  /** An https address, or an absolute file (Fedora's cached icons). */
  icon: string | null;
  categories: string[];
  keywords: string[];
  license: string | null;
  /** In the default order (installed first, then D321's): `offers[0]` is what Get uses. */
  offers: Offer[];
}

export interface CatalogData {
  /** Unix ms. */
  builtAt: number;
  sources: Source[];
  entries: CatalogEntry[];
}

/** A search's answer: apps and tools apart, as the page shows them. */
export interface SearchResult {
  apps: CatalogEntry[];
  tools: CatalogEntry[];
}
