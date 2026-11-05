/**
 * The Applet Store's lists: compact rows (icon, name, what it does and who
 * made it, the button that fits), in Software's grouped-row style. The
 * button is Get, Update, or a quiet "Installed"; a pulled one says so in red.
 */

import type { IndexApplet, InstalledApplet } from "@dashi/applet";
import { Group, tintFor, useColors } from "@dashi/ui";
import { Image, Text, View } from "@mirinjs/metal";
import { createContext, useContext, useSyncExternalStore } from "react";
import type { AppletStatus } from "../../src/applet-store/installer.ts";
import { ProgressBar, VerifiedBadge } from "../software/parts.tsx";
import { useServices, useStoreImage } from "./services.ts";

/** What a click asks for; the window provides it (and the sheets that come first). */
export interface Actions {
  openApplet(id: string): void;
  get(entry: IndexApplet): void;
  remove(installed: InstalledApplet): void;
}

export const ActionsContext = createContext<Actions | null>(null);

export function useActions(): Actions {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("the Applet Store's actions are not provided");
  return actions;
}

export function useStoreState() {
  const { store } = useServices();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/** The applet's icon from the catalog; its first letter on a tile until it is here. */
export function AppletIcon({ url, name, size }: { url?: string | undefined; name: string; size: number }) {
  const file = useStoreImage(url);
  if (file) return <Image source={file} style={{ width: size, height: size, borderRadius: size * 0.22 }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.22, alignItems: "center", justifyContent: "center", backgroundColor: tintFor(name) }}>
      <Text style={{ fontSize: size * 0.46, fontWeight: "semibold", color: "#ffffffee" }}>{([...name.trim()][0] ?? "?").toUpperCase()}</Text>
    </View>
  );
}

/** The button on a row or the page: Get, Update, Installed, or the progress while something is done. */
export function StatusButton({ entry, status, testID, wide }: { entry: IndexApplet; status: AppletStatus; testID: string; wide?: boolean }) {
  const colors = useColors();
  const actions = useActions();
  const busy = useStoreState().busy[entry.manifest.id];
  const minWidth = wide ? 96 : 72;
  if (busy) {
    return (
      <View testID={`${testID}:busy`} style={{ minWidth, flexShrink: 0, flexDirection: "column", alignItems: "center", gap: 4 }}>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>{busy === "installing" ? "Installing…" : "Removing…"}</Text>
        <ProgressBar fraction={null} width={minWidth} />
      </View>
    );
  }
  const label =
    status.kind === "get"
      ? status.version
        ? "Get"
        : "Not for this Dashi"
      : status.kind === "update"
        ? "Update"
        : status.kind === "pulled"
          ? "Pulled"
          : "Installed";
  const live = (status.kind === "get" && status.version !== null) || status.kind === "update" || (status.kind === "pulled" && status.good !== null);
  return (
    <View
      testID={testID}
      onPress={live ? () => actions.get(entry) : undefined}
      style={{
        minWidth,
        height: 26,
        flexShrink: 0,
        paddingHorizontal: 12,
        borderRadius: 13,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: live ? colors.button : "#00000000",
        ...(live ? { hoverBackgroundColor: colors.separator } : {}),
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: "bold", color: status.kind === "pulled" ? colors.critical : live ? colors.selection : colors.textMuted }}>
        {status.kind === "pulled" && status.good ? `Install ${status.good.version}` : label}
      </Text>
    </View>
  );
}

export function AppletRow({ entry }: { entry: IndexApplet }) {
  const colors = useColors();
  const actions = useActions();
  const { store } = useServices();
  useStoreState();
  const status = store.status(entry);
  const here = store.fitsHere(entry);
  const { manifest } = entry;
  const detail = [manifest.summary, manifest.author.name].join(" · ");
  return (
    <View
      testID={`applet:${manifest.id}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, paddingHorizontal: 12, paddingVertical: 8 }}
    >
      <View
        testID={`applet:${manifest.id}:open`}
        onPress={() => actions.openApplet(manifest.id)}
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <AppletIcon url={entry.icon} name={manifest.name} size={36} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
              {manifest.name}
            </Text>
            {entry.reviewed && <VerifiedBadge size={12} />}
            {here === true && manifest.when !== undefined && <Text style={{ fontSize: 11, color: colors.textMuted }}>· for this computer</Text>}
          </View>
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
            {detail}
          </Text>
        </View>
      </View>
      <StatusButton entry={entry} status={status} testID={`get:${manifest.id}`} />
    </View>
  );
}

/** A titled group of rows; nothing when there are none. */
export function RowGroup({ title, entries, testID }: { title?: string; entries: readonly IndexApplet[]; testID: string }) {
  const colors = useColors();
  if (entries.length === 0) return null;
  return (
    <View style={{ flexShrink: 0, flexDirection: "column", gap: 8 }}>
      {title !== undefined && <Text style={{ fontSize: 15, fontWeight: "bold", color: colors.text }}>{title}</Text>}
      <Group testID={testID}>
        {entries.map((entry) => (
          <AppletRow key={entry.manifest.id} entry={entry} />
        ))}
      </Group>
    </View>
  );
}
