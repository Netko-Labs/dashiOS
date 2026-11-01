/**
 * "Add Photo…": the desktop's own file chooser through xdg-desktop-portal
 * (portal/file-chooser.ts), filtered to photos (or videos for a live
 * wallpaper). Where there is no session bus or no portal (a development
 * run), `choose` rejects and System Settings offers a path field instead.
 */

import type { DBusConnection } from "../dbus/index.ts";
import { chooseFile, pathFromUri as fileFromUri, pickedPath as pickedFile } from "../portal/file-chooser.ts";
import { isPhotoPath } from "./catalog.ts";

export { requestPath } from "../portal/file-chooser.ts";

/** Picks a photo (or a video for a live wallpaper); null when the person cancelled. */
export interface PhotoChooser {
  choose(kind?: "photo" | "video"): Promise<string | null>;
}

/** The portal's title and filter for each kind of file. */
const DIALOGS = {
  photo: { title: "Choose a Photo", filter: { name: "Images", types: ["image/png", "image/jpeg"] } },
  video: { title: "Choose a Video", filter: { name: "Videos", types: ["video/mp4", "video/webm"] } },
} as const;

/** The photo path a `file://` URI names (percent-decoded), or null for anything else. */
export const pathFromUri = (uri: unknown): string | null => fileFromUri(uri, isPhotoPath);

/** The first usable photo of a `Response`'s results, or null (cancelled, or nothing we can use). */
export const pickedPath = (code: unknown, results: unknown): string | null => pickedFile(code, results, isPhotoPath);

export function portalChooser(connect?: () => Promise<DBusConnection>): PhotoChooser {
  return {
    choose: (kind = "photo") => chooseFile({ ...DIALOGS[kind], accept: isPhotoPath }, connect),
  };
}
