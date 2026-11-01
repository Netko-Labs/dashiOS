/** What Software knows of an app in the catalog. Every field has been through parse.ts. */

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
}

export interface Sizes {
  downloadSize: number | null;
  installedSize: number | null;
}
