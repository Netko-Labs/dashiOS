/** Software's public types: an app in the catalog (every field has been through parse), and what flatpak lists. */

import type { FlatpakPermissions } from "./flatpak-permissions.ts";
import type { Installation } from "./ids.ts";

export interface AppSummary {
  /** The Flatpak application id (ids.ts). */
  id: string;
  name: string;
  summary: string;
  developer: string | null;
  /** A media URL; the file is fetched into the image cache. */
  icon: string | null;
  verified: boolean;
  /** Flathub's main category ("graphics"), if it has one. */
  category: string | null;
  license: string | null;
  installsLastMonth: number | null;
  /** Unix seconds of the last update. */
  updatedAt: number | null;
}

export interface Page {
  apps: AppSummary[];
  page: number;
  totalPages: number;
  total: number;
}

export interface Screenshot {
  caption: string | null;
  /** A small size for the strip. */
  thumb: string;
  /** The size shown large: the biggest that is not huge. */
  large: string;
  width: number;
  height: number;
}

/** One release from AppStream, for "What's new". */
export interface Release {
  version: string | null;
  /** Unix seconds. */
  released: number | null;
  /** Its notes as plain-text paragraphs (html.ts); empty when it has none. */
  notes: string[];
}

export interface AppDetails extends AppSummary {
  /** Plain-text paragraphs (html.ts). */
  description: string[];
  screenshots: Screenshot[];
  homepage: string | null;
  version: string | null;
  /** Unix seconds of the newest release. */
  released: number | null;
  /** `org.gnome.Platform/x86_64/51`, when the catalog says. */
  runtime: string | null;
  eol: boolean;
  downloadSize: number | null;
  installedSize: number | null;
  categories: string[];
  /** The newest stable releases, newest first (at most 3). */
  releases: Release[];
  /** What it can reach, from the summary; null when Flathub didn't say. */
  permissions: FlatpakPermissions | null;
}

/** What the summary adds to a page: the sizes and the sandbox's permissions. */
export interface Sizes {
  downloadSize: number | null;
  installedSize: number | null;
  permissions: FlatpakPermissions | null;
}

export interface InstalledApp {
  id: string;
  name: string;
  version: string | null;
  branch: string;
  arch: string;
  origin: string;
  installation: Installation;
  /** Installed size in bytes, when flatpak says. */
  size: number | null;
  summary: string;
}

export interface FlatpakUpdate {
  id: string;
  name: string;
  version: string | null;
  branch: string;
  arch: string;
  origin: string;
  installation: Installation;
  downloadSize: number | null;
}
