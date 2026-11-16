/**
 * Installed, the apps that came as packages (flows/store row 10): from
 * Fedora, Terra, a COPR or Dashi, each with its source, Open and Remove….
 * Dashi's own parts are listed apart and can't be removed here. Command-line
 * tools aren't listed: dnf can't tell the ones the person added from the
 * thousands the system came with. What the system's first transaction
 * installed (the image: its helpers, Firefox) came with the computer and
 * isn't listed (dnf's history; D333). A package whose desktop file is no app
 * to open (a library's helper with NoDisplay, as Fcitx's Qt 6 wrapper) isn't
 * listed either (pass 37).
 */

import { Button, Group, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useMemo } from "react";
import type { CatalogData, CatalogEntry, Offer } from "../../../src/shared/software/index.ts";
import { useCatalog } from "./catalog-hooks.ts";
import { SectionHeader } from "./heading.tsx";
import { AppIcon, ROW, useActions } from "./parts.tsx";
import { useServices } from "./services.ts";
import { offerLabel } from "./source-words.ts";

function PackageRow({ entry, offer, label, dashi }: { entry: CatalogEntry; offer: Offer; label: string; dashi: boolean }) {
  const colors = useColors();
  const actions = useActions();
  const icon = entry.icon?.startsWith("/") ? { file: entry.icon } : { url: entry.icon };
  return (
    <View
      testID={`installed-package:${offer.ref}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: ROW.minHeight, paddingHorizontal: 12, paddingVertical: 8 }}
    >
      <View
        focusable
        accessibilityRole="button"
        accessibilityLabel={entry.name}
        onPress={() => actions.openEntry(entry.key, offer.source)}
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <AppIcon {...icon} name={entry.name} size={ROW.icon} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: "column", gap: 1 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>
            {entry.name}
          </Text>
          <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
            {[offer.version, label, dashi ? "part of Dashi · updates with Dashi" : null].filter(Boolean).join(" · ")}
          </Text>
        </View>
      </View>
      {entry.desktopId !== null && <Button label="Open" testID={`open-package:${offer.ref}`} onPress={() => actions.openPackage(entry)} />}
      {!dashi && <Button label="Remove…" testID={`remove-package:${offer.ref}`} onPress={() => actions.removePackage(entry, offer)} />}
    </View>
  );
}

export interface PackageRowData {
  entry: CatalogEntry;
  offer: Offer;
  dashi: boolean;
  label: string;
}

/** The package apps Installed lists for `needle`: installed from a package, added by the person, and an app to open. */
export function packageRows(data: CatalogData, needle: string, unlisted: ReadonlySet<string>): PackageRowData[] {
  const rows = data.entries.flatMap((entry) => {
    if (entry.kind !== "app") return [];
    const offer = entry.offers.find((each) => each.kind === "rpm" && each.installed);
    if (!offer) return [];
    if (offer.cameWithSystem) return [];
    if (entry.desktopId !== null && unlisted.has(entry.desktopId)) return [];
    if (needle !== "" && !`${entry.name} ${offer.ref}`.toLowerCase().includes(needle)) return [];
    const dashi = data.sources.find((source) => source.id === offer.source)?.dashi === true;
    return [{ entry, offer, dashi, label: offerLabel(data.sources, offer) }];
  });
  return rows.sort((a, b) => Number(a.dashi) - Number(b.dashi) || a.entry.name.localeCompare(b.entry.name));
}

/** The desktop ids that are no app to open, read once per catalog (what is installed changes with it). */
export function useUnlisted(data: CatalogData | null): ReadonlySet<string> {
  const { unlistedApps } = useServices();
  return useMemo(() => (data === null ? new Set<string>() : unlistedApps()), [data, unlistedApps]);
}

export function InstalledPackages({ needle }: { needle: string }) {
  const data = useCatalog();
  const unlisted = useUnlisted(data);
  if (data === null) return null;
  const rows = packageRows(data, needle, unlisted);
  if (rows.length === 0) return null;
  return (
    <>
      <SectionHeader title="Apps from packages" detail="The ones you added from Fedora, Terra or a COPR. They aren’t sandboxed." />
      <Group testID="installed-packages">
        {rows.map((row) => (
          <PackageRow key={row.entry.key} {...row} />
        ))}
      </Group>
    </>
  );
}
