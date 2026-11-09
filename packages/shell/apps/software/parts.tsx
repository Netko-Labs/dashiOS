/** Small pieces the pages share: what a click asks the window for, and an app's or applet's icon. */

import type { InstalledApplet } from "@dashi/applet";
import { tintFor } from "@dashi/ui";
import { Image, Text, View } from "@mirinjs/metal";
import { createContext, useContext } from "react";
import type { StoreApplet } from "../../src/applet-store/merge.ts";
import type { InstalledApp } from "../../src/software/flatpak-parse.ts";
import type { Installation } from "../../src/software/ids.ts";
import { useImage } from "./hooks.ts";

/**
 * One row geometry for every app and applet in a list (Installed, Updates,
 * the applets): the icon, the row's least height, and the inset of its
 * content from the card's outer edge (the card's 1 px edge and the row's 12
 * of padding). Section headings and the About text use the same inset, so
 * a heading's button ends where the rows' buttons do.
 */
export const ROW = { icon: 44, minHeight: 60, inset: 13 } as const;

/** What a click asks for; the window provides it (and the sheets that come first). */
export interface Actions {
  openApp(id: string): void;
  openApplet(id: string): void;
  /** Gets an app: at once, or after the trust card as a sheet when it asks for broad access. */
  install(id: string, name: string): void;
  launch(id: string): void;
  update(app: InstalledApp, name: string): void;
  /** Updates every app in an installation. */
  updateAll(installation: Installation): void;
  /** Asks first (Remove…), with "Also delete its settings and data". */
  remove(app: InstalledApp): void;
  /** Stops a change, or takes a waiting one back. */
  cancel(key: string): void;
  /** Gets or updates an applet: the consent sheet first when it asks for anything new. */
  getApplet(entry: StoreApplet): void;
  removeApplet(applet: InstalledApplet): void;
  openUrl(url: string): void;
  /** Shows a screenshot's file at the window's full size. */
  showPicture(file: string): void;
}

export const ActionsContext = createContext<Actions | null>(null);

export function useActions(): Actions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("Software's actions are not provided");
  return actions;
}

/** An app's (or applet's) icon from a file or a URL in its image cache; until it is here, its first letter on a tinted tile. */
export function AppIcon({
  url,
  file,
  name,
  size,
  source = "flathub",
}: {
  url?: string | null | undefined;
  file?: string | null;
  name: string;
  size: number;
  source?: "flathub" | "applets";
}) {
  const downloaded = useImage(file ? null : (url ?? null), source);
  const path = file ?? downloaded;
  // An icon keeps its size in a row short of room: the words beside it give way.
  if (path)
    return (
      <View style={{ width: size, height: size, flexShrink: 0 }}>
        <Image source={path} style={{ width: size, height: size, borderRadius: size * 0.22 }} />
      </View>
    );
  return (
    <View
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: size * 0.22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tintFor(name),
      }}
    >
      <Text style={{ fontSize: Math.round(size * 0.46), fontWeight: "semibold", color: "#ffffffee" }}>{([...name.trim()][0] ?? "?").toUpperCase()}</Text>
    </View>
  );
}
