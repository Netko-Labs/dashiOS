/** Where a Files window is looking, and the sidebar's list of places. */

import { baseName, crumbs, isInside, type UserDirName } from "../files/index.ts";

export type Location = { kind: "folder"; path: string } | { kind: "recents" } | { kind: "trash" };

export const folderAt = (path: string): Location => ({ kind: "folder", path });

export function sameLocation(a: Location, b: Location): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === "folder" && b.kind === "folder" ? a.path === b.path : true;
}

export function locationTitle(location: Location, home: string): string {
  if (location.kind === "recents") return "Recents";
  if (location.kind === "trash") return "Trash";
  if (location.path === home) return baseName(home) || "Home";
  return location.path === "/" ? "Computer" : baseName(location.path);
}

export type GlyphName =
  | "recents"
  | "home"
  | "desktop"
  | "documents"
  | "downloads"
  | "pictures"
  | "music"
  | "videos"
  | "drive"
  | "usb"
  | "trash"
  | "network"
  | "folder";

export interface Place {
  id: string;
  name: string;
  glyph: GlyphName;
  location: Location;
}

const NAMES: Record<UserDirName, { name: string; glyph: GlyphName }> = {
  DESKTOP: { name: "Desktop", glyph: "desktop" },
  DOCUMENTS: { name: "Documents", glyph: "documents" },
  DOWNLOAD: { name: "Downloads", glyph: "downloads" },
  PICTURES: { name: "Pictures", glyph: "pictures" },
  MUSIC: { name: "Music", glyph: "music" },
  VIDEOS: { name: "Videos", glyph: "videos" },
};

/** The sidebar's Favorites, in the order people expect: Recents, Home, then the standard folders. */
export function favorites(dirs: ReadonlyArray<{ name: UserDirName; path: string }>, home: string): Place[] {
  const order: UserDirName[] = ["DESKTOP", "DOCUMENTS", "DOWNLOAD", "PICTURES", "MUSIC", "VIDEOS"];
  return [
    { id: "recents", name: "Recents", glyph: "recents", location: { kind: "recents" } },
    { id: "home", name: "Home", glyph: "home", location: folderAt(home) },
    ...order.flatMap((name) => {
      const dir = dirs.find((each) => each.name === name);
      return dir ? [{ id: `dir:${name}`, ...NAMES[name], location: folderAt(dir.path) }] : [];
    }),
  ];
}

/** Whether the sidebar row for `place` is the one to light for `location`: the place itself, or the nearest favorite above a deeper path is not lit (only exact matches are). */
export function isCurrent(place: Place, location: Location): boolean {
  return sameLocation(place.location, location);
}

/** The omnibox's crumbs for a location. */
export function pathSegments(location: Location, home: string, trashFiles?: string): Array<{ name: string; location: Location }> {
  if (location.kind === "recents") return [{ name: "Recents", location }];
  if (location.kind === "trash") return [{ name: "Trash", location }];
  // A folder inside the Trash reads as "Trash > folder", not as the Trash's place on disk.
  if (trashFiles && isInside(trashFiles, location.path)) {
    const inner = crumbs(location.path, trashFiles).slice(1);
    return [{ name: "Trash", location: { kind: "trash" } }, ...inner.map((crumb) => ({ name: crumb.name, location: folderAt(crumb.path) }))];
  }
  return crumbs(location.path, home).map((crumb) => ({ name: crumb.name, location: folderAt(crumb.path) }));
}
